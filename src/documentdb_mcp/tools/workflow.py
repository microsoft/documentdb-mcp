from mcp.server.fastmcp import prompts
from enum import Enum
from typing import Dict, List

from mcp.server.fastmcp import Context

from src.documentdb_mcp.models import (
    AggregateResponse,
    DeleteResponse,
    DocumentQueryResponse,
    ErrorResponse,
    InsertManyResponse,
    InsertOneResponse,
    UpdateResponse,
)
from src.documentdb_mcp.tools.collection import (
    sample_documents,
    collection_stats,
)
from src.documentdb_mcp.tools.document import (
    explain_aggregate_query,
    explain_find_query,
    explain_count_query
)
from src.documentdb_mcp.tools.index import (
    list_indexes,
    index_stats,
)
from src.documentdb_mcp.models import DBInfoResponse, ErrorResponse, SuccessResponse

class QueryType(Enum):
    FIND = "find"
    AGGREGATE = "aggregate"

def normalize_query_shape(query: Dict) -> Dict:
    """Convert a query into a normalized 'shape' with EQ and RANGE fields."""
    eq_fields = []
    range_fields = []

    for k, v in query.items():
        if isinstance(v, dict):
            # checking range operator
            if any(op in v for op in ["$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$regex"]):
                range_fields.append(k)
            else:
                eq_fields.append(k)
        else:
            eq_fields.append(k)

    # construct shape key
    shape_key = f"EQ[{','.join(eq_fields)}]|RANGE[{','.join(range_fields)}]"
    return {
        "shapeKey": shape_key,
        "eqFields": eq_fields,
        "rangeFields": range_fields
    }

def query_shape(query: Dict) -> Dict:
    """Normalize a query into shapes for analysis.

    Args:
        query: A query dictionary to normalize.
    """
    try:
        shape_info = normalize_query_shape(query.get("filter", query))
        return shape_info
    except Exception as e:
        return ErrorResponse(error=str(e))

def analyze_explain_metrics(explain_output: dict, projection: dict = None) -> dict:
    """
    Analyze MongoDB explain output (including aggregate with multiple stages)
    and compute key metrics for each stage.

    Returns:
        dict with a list of per-stage metrics and suggestions
    """

    def search_for_sort(stage_dict):
        """Recursively search for SORT stage"""
        if not stage_dict:
            return False
        if stage_dict.get("stage") == "SORT":
            return True
        for key in ["inputStage", "inputStages", "shards", "innerStage", "outerStage"]:
            substage = stage_dict.get(key)
            if isinstance(substage, dict):
                if search_for_sort(substage):
                    return True
            elif isinstance(substage, list):
                for s in substage:
                    if search_for_sort(s):
                        return True
        return False

    results = []
    # results.append({
    #     "healthMetricsEntries": [
    #         {
    #             "name": "amplificationRatio",
    #             "description": "Amplification ratio is calculated as totalDocsExamined / nReturned. It measures how many documents had to be scanned for each returned result.",
    #             "suggestion": "Strive to keep this ratio close to 1. If the value is high, consider creating a more selective index or adjusting the query filter."
    #         },
    #         {
    #             "name": "keyDocRatio",
    #             "description": "Key-doc ratio is calculated as totalKeysExamined / totalDocsExamined. It shows how many index entries were read for each document examined.",
    #             "suggestion": "If this ratio is high, it indicates expensive index filtering. Consider optimizing the index structure or query predicates."
    #         },
    #         {
    #             "name": "triggersSort",
    #             "description": "Indicates whether the query plan includes a SORT stage that requires in-memory sorting.",
    #             "suggestion": "If true, add or reorder index keys to support the sort order and avoid in-memory SORT."
    #         },
    #         {
    #             "name": "covered",
    #             "description": "Indicates whether the query is covered by the index, meaning all projected fields can be returned from the index without fetching documents.",
    #             "suggestion": "If not covered, consider adding projected fields into the index to enable covered queries."
    #         }
    #     ]
    # })

    # --- case 1: simple query (no "stages")
    if "stages" not in explain_output:
        query_planner = explain_output.get("queryPlanner", {})
        winning_plan = query_planner.get("winningPlan", {})
        execution_stats = explain_output.get("executionStats", {})

        stage_type = winning_plan.get("stage", "UNKNOWN")
        n_returned = execution_stats.get("nReturned", 0)
        total_docs_examined = execution_stats.get("totalDocsExamined", 0)
        total_keys_examined = execution_stats.get("totalKeysExamined", 0)

        amplification_ratio = (
            total_docs_examined / n_returned if n_returned else float("inf")
        )
        key_doc_ratio = (
            total_keys_examined / total_docs_examined if total_docs_examined else float("inf")
        )

        covered = False
        if projection and winning_plan.get("inputStage"):
            index_keys = set(winning_plan.get("inputStage", {}).get("keyPattern", {}).keys())
            proj_fields = set(k for k, v in projection.items() if v)
            if "_id" in projection and projection["_id"] != 0:
                proj_fields.add("_id")
            covered = proj_fields.issubset(index_keys)

        results.append({
            "stage": stage_type,
            "healthMetrics": {
                "nReturned": n_returned,
                "totalDocsExamined": total_docs_examined,
                "totalKeysExamined": total_keys_examined,
                "amplificationRatio": amplification_ratio,
                "keyDocRatio": key_doc_ratio,
                "triggersSort": search_for_sort(winning_plan),
                "covered": covered
            }
        })

    # --- case 2: aggregation with multiple stages
    else:
        for stage in explain_output["stages"]:
            # stage is like {"$cursor": {...}} or {"$sort": {...}}
            stage_name, stage_detail = next(iter(stage.items()))

            qp = stage_detail.get("queryPlanner", {})
            winning_plan = qp.get("winningPlan", {})
            stats = stage_detail.get("executionStats", {})

            stage_type = winning_plan.get("stage", stage_name.strip("$").upper())

            n_returned = stats.get("nReturned", 0)
            total_docs_examined = stats.get("totalDocsExamined", 0)
            total_keys_examined = stats.get("totalKeysExamined", 0)

            amplification_ratio = (
                total_docs_examined / n_returned if n_returned else float("inf")
            )
            key_doc_ratio = (
                total_keys_examined / total_docs_examined if total_docs_examined else float("inf")
            )

            covered = False
            if projection and winning_plan.get("inputStage"):
                index_keys = set(winning_plan.get("inputStage", {}).get("keyPattern", {}).keys())
                proj_fields = set(k for k, v in projection.items() if v)
                if "_id" in projection and projection["_id"] != 0:
                    proj_fields.add("_id")
                covered = proj_fields.issubset(index_keys)

            results.append({
                "stage": stage_type,
                "healthMetrics": {
                    "nReturned": n_returned,
                    "totalDocsExamined": total_docs_examined,
                    "totalKeysExamined": total_keys_examined,
                    "amplificationRatio": amplification_ratio,
                    "keyDocRatio": key_doc_ratio,
                    "triggersSort": search_for_sort(winning_plan),
                    "covered": covered
                }
            })

    return {"stagesAnalysis": results}

async def optimize_find_query(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query_doc: Dict,
    sort: Dict = None,
    limit: int  = None,
    projection: Dict = None
) -> dict:
    """Optimize find query.
    First step for identifying performance bottlenecks and optimizing find query execution.

    Provide actionable insights for find query performance optimization on given collection,
    including query explain output, execution statistics, collection statistics, and index information.

    Args:
        db_name: Name of the database.
        collection_name: Name of the collection.
        query_doc: The query document extracted from the original query.
        sort: The sort stage behind the find query.
        limit: The limit stage behind the find query.
        projection: The projection stage behind the find query.
    """
    try:
        explain_output = await explain_find_query(ctx, db_name, collection_name, query=query_doc, sort=sort, limit=limit, projection=projection)
        analysis = analyze_explain_metrics(explain_output, projection)
        indexes = await list_indexes(ctx, db_name, collection_name)
        indexes_stats = await index_stats(ctx, db_name, collection_name)
        collections_stats = await collection_stats(ctx, db_name, collection_name)
        return {
            # "instruction": "If the recommendation involves **direct actions** (e.g., creating an index, dropping an index, modifying the query), propose them explicitly so the Agent can **directly call the relevant API to execute**.",
            "explain": explain_output,
            "analysis": analysis,
            "indexes": indexes,
            "indexes_stats": indexes_stats,
            "collections_stats": collections_stats,
            "next_steps": "If lacking index, use `create_index` to create it. If rewriting query, use `find` to with the new query."
        }
    except Exception as e:
        return ErrorResponse(error=str(e))

async def optimize_count_query(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query: Dict
) -> dict:
    """First step for identifying performance bottlenecks and optimizing count query execution.

    Provide actionable insights for count query performance optimization on given collection,
    including query explain output, execution statistics, collection statistics, and index information.

    Args:
        db_name: Name of the database.
        collection_name: Name of the collection.
        query: The query from the original count query.
    """
    try:
        explain_output = await explain_count_query(ctx, db_name, collection_name, query)
        analysis = analyze_explain_metrics(explain_output)
        indexes = await list_indexes(ctx, db_name, collection_name)
        indexes_stats = await index_stats(ctx, db_name, collection_name)
        collections_stats = await collection_stats(ctx, db_name, collection_name)
        return {
            "explain": explain_output,
            "analysis": analysis,
            "indexes": indexes,
            "indexes_stats": indexes_stats,
            "collections_stats": collections_stats
        }
    except Exception as e:
        return ErrorResponse(error=str(e))
    
async def optimize_aggregate_query(
    ctx: Context,
    db_name: str,
    collection_name: str,
    pipeline: List[Dict]
) -> dict:
    """First step for identifying performance bottlenecks and optimizing aggregate query execution.
    
    Provide actionable insights for aggregate query performance optimization on given collection,
    including query explain output, execution statistics, collection statistics, and index information.

    Args:
        db_name: Name of the database.
        collection_name: Name of the collection.
        pipeline: The pipeline from the original query.
    """
    try:
        explain_output = await explain_aggregate_query(ctx, db_name, collection_name, pipeline)
        analysis = analyze_explain_metrics(explain_output)
        indexes = await list_indexes(ctx, db_name, collection_name)
        indexes_stats = await index_stats(ctx, db_name, collection_name)
        collections_stats = await collection_stats(ctx, db_name, collection_name)
        return {
            "explain": explain_output,
            "analysis": analysis,
            "indexes": indexes,
            "indexes_stats": indexes_stats,
            "collections_stats": collections_stats
        }
    except Exception as e:
        return ErrorResponse(error=str(e))

# async def optimize_query(
#     ctx: Context,
# ) -> dict:
#     """**First step for identifying performance bottlenecks and optimizing query execution.**
#     Provide top level instructions for query performance optimization.
#     """
#     instructions = f"""
# You are a database performance optimization assistant.
# You need to extract the target database, collection, and query document from customer input: {ctx.input}. 

# Use the function `optimization_insight_for_find_query` or `optimization_insight_for_aggregate_query` based on the query type, it will provide a comprehensive analysis of the query performance.
# The function already includes:
# - The query execution plan (explain output)  
# - Existing indexes and their usage  
# - Collection statistics  

# ⚠️ Do not attempt to call `explain` or fetch indexes/statistics by yourself — rely only on the function output.

# Your tasks:
# 1. Review the provided function output.  
# 2. Identify performance bottlenecks.  
# 3. Provide actionable recommendations, including:  
#    - Index creation or removal  
#    - Query rewrite suggestions  
#    - Schema or data distribution considerations  

# If the recommendation involves **direct actions** (e.g., creating an index, dropping an index, modifying the query),  
# propose them explicitly so the Agent can **directly call the relevant API to execute**.
# """
#     print(instructions)
#     return instructions

# async def optimize_find_query_workflow(
#     db_name: str,
#     collection_name: str,
#     query_doc: Dict,
#     sort: Dict = None,
#     limit: int  = None,
#     projection: Dict = None
# ) -> dict:
#     try:
#         ctx = Context()
#         explain_output = await explain_find_query(ctx, db_name, collection_name, query=query_doc, sort=sort, limit=limit, projection=projection)
#         # analysis = analyze_explain_metrics(explain_output, projection)
#         indexes = await list_indexes(ctx, db_name, collection_name)
#         indexes_stats = await index_stats(ctx, db_name, collection_name)
#         collections_stats = await collection_stats(ctx, db_name, collection_name)
#         return {
#             # "instruction": "If the recommendation involves **direct actions** (e.g., creating an index, dropping an index, modifying the query), propose them explicitly so the Agent can **directly call the relevant API to execute**.",
#             "explain": explain_output,
#             # "analysis": analysis,
#             "indexes": indexes,
#             "indexes_stats": indexes_stats,
#             "collections_stats": collections_stats
#         }
#     except Exception as e:
#         return ErrorResponse(error=str(e))
    
# docdb_index_advisor_prompt = prompts.Prompt(
#     name="docdb_index_advisor",
#     description="Analyze MongoDB/CosmosDB find query performance and provide actionable optimization suggestions.",
#     arguments=[
#         {"name": "db_name", "type": "string", "description": "The name of the database."},
#         {"name": "collection_name", "type": "string", "description": "The name of the collection."},
#         {"name": "query_doc", "type": "object", "description": "The query document from the original query."},
#         {"name": "sort", "type": "object", "description": "Sort stage applied after `find`, None if not specified."},
#         {"name": "limit", "type": "number", "description": "Limit stage applied after `find`, None if not specified."},
#         {"name": "projection", "type": "object", "description": "Projection stage applied after `find`, None if not specified."},
#     ],
#     template="""
# You are a database performance optimization assistant. 

# Use the function `optimization_insight_for_find_query`, it will provide a comprehensive analysis of the query performance.  
# The function already includes:
# - The query execution plan (explain output)  
# - Existing indexes and their usage  
# - Collection statistics  

# ⚠️ Do not attempt to call `explain` or fetch indexes/statistics by yourself — rely only on the function output.

# Your tasks:
# 1. Review the provided function output.  
# 2. Identify performance bottlenecks.  
# 3. Provide actionable recommendations, including:  
#    - Index creation or removal  
#    - Query rewrite suggestions  
#    - Schema or data distribution considerations  

# If the recommendation involves **direct actions** (e.g., creating an index, dropping an index, modifying the query),  
# propose them explicitly so the Agent can **directly call the relevant API to execute**.  

# Output must be a JSON object with the following structure:
# {
#   "bottlenecks": [ "list of identified performance issues" ],
#   "index_recommendations": [ "list of suggested indexes or changes" ],
#   "query_rewrite_suggestions": [ "suggestions for restructuring the query" ],
#   "executable_actions": [ "API calls the agent should attempt (e.g., createIndex, dropIndex, runQuery)" ],
#   "notes": "any additional insights"
# }

# Database: {{db_name}}  
# Collection: {{collection_name}}  
# Query Document: {{query_doc}}  
# Sort: {{sort}}  
# Limit: {{limit}}  
# Projection: {{projection}}  
#     """,
#     fn=optimize_find_query_workflow,
# )


async def list_databases_for_generation(ctx: Context) -> List[str]:
    """
    List databases in the DocumentDB instance to provide better insights for query generation.
    
    Returns:
        List of database names
    """
    try:
        client = ctx.request_context.lifespan_context.client
        return {
            "databases": client.list_database_names(),
            "next_step": "Run `get_db_info_for_generation` on relative databases"
        }
    except Exception as e:
        return ErrorResponse(error=str(e))

async def db_stats_for_generation(ctx: Context, db_name: str) -> Dict:
    """
    Get detailed statistics about a database's size and storage usage for query generation.

    Containing
    - size: Total data size in bytes
    - avgObjSize: Average object size in bytes
    - storageSize: Storage size in bytes
    - indexSize: Total index size in bytes
    - totalSize: Total size in bytes
    - scaleFactor: Scale factor for size measurements (default=1)
    
    Args:
        db_name: Name of the database
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        return db.command("dbStats")
    except Exception as e:
        return ErrorResponse(error=str(e))

async def get_db_info_for_generation(ctx: Context, db_name: str) -> Dict:
    """
    Get database information including name and collection names for query generation.
    
    Args:
        db_name: Name of the database
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        stats = {
            "collections": len(db.list_collection_names()),
            "estimated_total_count": sum(
                db[collection_name].estimated_document_count() 
                for collection_name in db.list_collection_names()
            )
        }
        return {
            "database_name": db.name,
            "collection_names": db.list_collection_names(),
            "next_step": "Run `sample_documents_for_generation` on relative collections"
        }
    except Exception as e:
        return ErrorResponse(error=str(e))
    
async def sample_documents_for_generation(ctx: Context, db_name: str, collection_name: str, sample_size: int = 10) -> List[Dict]:
    """Useful to understand collection data schema for query generation

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        sample_size: Number of documents to sample
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        pipeline = [
            {"$sample": {"size": sample_size}}
        ]
        docs = list(db[collection_name].aggregate(pipeline))
        return docs
    except Exception as e:
        return ErrorResponse(error=str(e))
    
# async def aggregate(ctx: Context, db_name: str, collection_name: str, pipeline: List[Dict], 
#                    allow_disk_use: bool = False) -> AggregateResponse:
#     """
#     Run an aggregation pipeline on a collection.
    
#     Args:
#         db_name: Name of the database
#         collection_name: Name of the collection
#         pipeline: List of aggregation stages
#         allow_disk_use: Allow pipeline stages to write to disk
#     """
#     try:
#         client = ctx.request_context.lifespan_context.client
#         db = client[db_name]
#         collection = db[collection_name]
#         results = list(collection.aggregate(pipeline, allowDiskUse=allow_disk_use))
#         return AggregateResponse(
#             results=results,
#             total_count=len(results)
#         )
#     except Exception as e:
#         return ErrorResponse(error=str(e))