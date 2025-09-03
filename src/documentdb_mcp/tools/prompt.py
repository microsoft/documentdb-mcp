from mcp.server.fastmcp import prompts
from typing import Dict, List
from src.documentdb_mcp.tools.collection import (
    collection_stats,
    drop_collection,
    rename_collection,
    sample_documents,
)
from src.documentdb_mcp.tools.database import (
    db_stats,
    drop_database,
    get_db_info,
    list_databases,
)
from src.documentdb_mcp.tools.document import (
    aggregate,
    count_documents,
    delete_document,
    delete_many,
    explain_aggregate_query,
    explain_find_query,
    find_documents,
    find_and_modify,
    insert_document,
    insert_many,
    update_document,
    update_many,
    query_on_different_collections
)
from src.documentdb_mcp.tools.index import (
    create_index,
    current_ops,
    drop_index,
    index_stats,
    list_indexes,
)

from src.documentdb_mcp.tools.workflow import (
    optimization_insight_for_find_query,
    optimization_insight_for_aggregate_query
)

async def cross_collection_prompt_fn(ctx, left_db: str,
    right_db: str,
    left_collection: str,
    right_collection: str,
    local_field: str,
    foreign_field: str,
    left_query: Dict = {},
    right_query: Dict = {},
    join_type: str = "inner",
    limit: int = 100,
    skip: int = 0):
    """
    This fn will be called by Agent with parameters determined at runtime.
    It uses Tools (find_documents, join_collections) to fetch and combine data.
    """
    return query_on_different_collections(ctx, left_db, right_db, left_collection, right_collection, local_field, foreign_field, left_query, right_query, join_type, limit, skip)

cross_collection_prompt = prompts.Prompt(
    name="docdb_cross_collection_query",
    description="Guidance for agent to write cross-collection mongo queries",
    arguments=[
        {"name": "query_description", "type": "string", "description": "Description of the user's query across collections"}
    ],
    template="""
The user wants to query across multiple collections.
Strategy:
1. Identify relevant databases and collections from user's query.
2. Sample documents from each collection.
3. Join data if needed (cross-db or cross-collection).
4. Return combined results.

User request: {{query_description}}
    """,
    fn=cross_collection_prompt_fn,
)

# query_optimization_prompt = prompts.Prompt(
#     name="docdb_query_optimization",
#     description="Guide the agent to optimize queries using explain plans",
#     arguments=[
#         {"name": "explain_result", "type": "string", "description": "The explain output from MongoDB or DocumentDB"}
#     ],
#     template="""
# The user wants to optimize a query.
# Steps:
# 1. Analyze the explain result carefully.
# 2. Identify whether indexes are used (`IXSCAN`), or if COLLSCAN is happening.
# 3. Suggest possible optimizations: add index, rewrite filter, adjust sort order, etc.
# 4. Explain reasoning in simple terms.

# Explain output:
# {{explain_result}}
#     """
# )