from mcp.server.fastmcp import FastMCP, Context
from src.documentdb_mcp.mcp_config import HOST, PORT
from src.documentdb_mcp.context_manager import documentdb_lifespan
from src.documentdb_mcp.models import DBInfoResponse, DocumentQueryResponse, InsertOneResponse, InsertManyResponse, UpdateResponse, DeleteResponse, AggregateResponse, CreateIndexResponse, ListIndexesResponse, ErrorResponse
from typing import Optional, Dict, Any, List
from db_tools import list_databases
mcp = FastMCP(
    "documentdb-mcp",
    description="MCP server for DocumentDB database operations",
    lifespan=documentdb_lifespan,
    host=HOST,
    port=PORT
)

@mcp.tool()(list_databases)

@mcp.tool()
async def db_stats(ctx: Context, db_name: str) -> Dict:
    """
    Get database statistics.
    Note dbStats.scaleFactor is 1 by default then dbStats.size, dbStats.avgObjSize, dbStats.storageSize, dbStats.indexSize, dbStats.totalSize are in bytes.
    
    Args:
        db_name: Name of the database
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        # ToDo wrap the response
        return db.command("dbStats")
    except Exception as e:
        return ErrorResponse(error=str(e))


@mcp.tool()
async def get_db_info(ctx: Context, db_name: str) -> DBInfoResponse:
    """Get database information including name and collection names.
    
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
        return DBInfoResponse(
            database_name=db.name,
            collection_names=db.list_collection_names(),
            stats=stats
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def collection_stats(ctx: Context, db_name: str, collection_name: str) -> Dict:
    """
    Get collection statistics includes size, count, avgObjSize, storageSize, nindexes, indexBuilds, totalIndexSize, totalSize, indexSizes, scaleFactor.
    Note size, avgObjSize, storageSize, totalIndexSize, totalSize, indexSizes are in bytes when scaleFactor is 1.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
    
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        return db.command("collStats", collection_name)
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def rename_collection(ctx: Context, db_name: str, collection_name: str, new_collection_name: str) -> Dict:
    """
    Rename a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection to rename
        new_collection_name: New name for the collection
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        db[collection_name].rename(new_collection_name)
        return {"message": "Collection renamed successfully"}
    except Exception as e:
        return ErrorResponse(error=str(e))


# todo add pagination
@mcp.tool()
async def find_documents(ctx: Context, db_name: str, collection_name: str, query: Dict = {}, 
                        limit: int = 100, skip: int = 0) -> DocumentQueryResponse:
    """
    Find documents in a collection using a query.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection to query
        query: Query filter (MongoDB style)
        limit: Maximum number of documents to return
        skip: Number of documents to skip
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        
        cursor = collection.find(query).skip(skip).limit(limit)
        documents = list(cursor)
        total_count = collection.estimated_document_count() if not query else collection.count_documents(query)
        
        return DocumentQueryResponse(
            documents=documents,
            total_count=total_count,
            limit=limit,
            skip=skip,
            has_more=(skip + len(documents)) < total_count
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def count_documents(ctx: Context, db_name: str, collection_name: str, query: Dict = {}) -> int:
    """
    Count the number of documents in a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        query: Query filter (MongoDB style)
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        return collection.count_documents(query)
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def insert_document(ctx: Context, db_name: str, collection_name: str, document: Dict) -> InsertOneResponse:
    """
    Insert a single document into a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        document: Document to insert
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.insert_one(document)
        return InsertOneResponse(
            inserted_id=str(result.inserted_id),
            acknowledged=result.acknowledged,
            inserted_count=1
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def insert_many(ctx: Context, db_name: str, collection_name: str, documents: List[Dict]) -> InsertManyResponse:
    """
    Insert multiple documents into a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        documents: List of documents to insert
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.insert_many(documents)
        return InsertManyResponse(
            inserted_ids=[str(id) for id in result.inserted_ids],
            acknowledged=result.acknowledged,
            inserted_count=len(result.inserted_ids)
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def update_document(ctx: Context, db_name: str, collection_name: str, filter: Dict, 
                         update: Dict, upsert: bool = False) -> UpdateResponse:
    """
    Update a document in a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        filter: Query filter to find the document
        update: Update operations ($set, $inc, etc.)
        upsert: Create document if it doesn't exist
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.update_one(filter, update, upsert=upsert)
        return UpdateResponse(
            matched_count=result.matched_count,
            modified_count=result.modified_count,
            upserted_id=str(result.upserted_id) if result.upserted_id else None,
            acknowledged=result.acknowledged
        )
    except Exception as e:
        return ErrorResponse(error=str(e))


@mcp.tool()
async def update_many(ctx: Context, db_name: str, collection_name: str, filter: Dict, 
                      update: Dict, upsert: bool = False) -> UpdateResponse:
    """
    Update multiple documents in a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        filter: Query filter to find the documents
        update: Update operations ($set, $inc, etc.)
        upsert: Create document if it doesn't exist
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.update_many(filter, update, upsert=upsert)
        return UpdateResponse(
            matched_count=result.matched_count,
            modified_count=result.modified_count,
            upserted_id=str(result.upserted_id) if result.upserted_id else None,
            acknowledged=result.acknowledged
        )
    except Exception as e:
        return ErrorResponse(error=str(e))



@mcp.tool()
async def aggregate(ctx: Context, db_name: str, collection_name: str, pipeline: List[Dict], 
                   allow_disk_use: bool = False) -> AggregateResponse:
    """
    Run an aggregation pipeline on a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        pipeline: List of aggregation stages
        allow_disk_use: Allow pipeline stages to write to disk
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        results = list(collection.aggregate(pipeline, allowDiskUse=allow_disk_use))
        return AggregateResponse(
            results=results,
            total_count=len(results)
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

#### Index Operations
@mcp.tool()
async def create_index(ctx: Context, db_name: str, collection_name: str, keys: Dict, 
                      unique: bool = False, name: Optional[str] = None) -> Dict:
    """
    Create an index on a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        keys: Dictionary defining the index (e.g., {'field': 1} for ascending)
        unique: Whether the index should be unique
        name: Optional name for the index
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        
        index_name = collection.create_index(
            list(keys.items()),
            unique=unique,
            name=name
        )

        return CreateIndexResponse(
            index_name=index_name,
            keys=keys,
            unique=unique
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def list_indexes(ctx: Context, db_name: str, collection_name: str) -> List[Dict]:
    """
    List all indexes on a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        indexes = list(collection.list_indexes())
        return ListIndexesResponse(indexes=indexes)
    except Exception as e:
        return ErrorResponse(error=str(e))

## Danger Zone
@mcp.tool()
async def delete_document(ctx: Context, db_name: str, collection_name: str, filter: Dict) -> DeleteResponse:
    """
    Delete a document from a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        filter: Query filter to find the document
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.delete_one(filter)
        return DeleteResponse(
            deleted_count=result.deleted_count,
            acknowledged=result.acknowledged
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

# delete many
@mcp.tool()
async def delete_many(ctx: Context, db_name: str, collection_name: str, filter: Dict) -> DeleteResponse:
    """
    Delete multiple documents from a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        filter: Query filter to find the documents
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.delete_many(filter)
        return DeleteResponse(
            deleted_count=result.deleted_count,
            acknowledged=result.acknowledged
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def drop_index(ctx: Context, db_name: str, collection_name: str, index_name: str) -> Dict:
    """
    Drop an index from a collection.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        index_name: Name of the index to drop
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        collection.drop_index(index_name)
        return {"message": "Index dropped successfully"}
    except Exception as e:
        return ErrorResponse(error=str(e))
    
@mcp.tool()
async def drop_collection(ctx: Context, db_name: str, collection_name: str) -> Dict:
    """
    Drop a collection from a database.
    
    Args:
        db_name: Name of the database
        collection_name: Name of the collection to drop
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        db.drop_collection(collection_name)
        return {"message": "Collection dropped successfully"}
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def drop_database(ctx: Context, db_name: str) -> Dict:
    """
    Drop a database.
    
    Args:
        db_name: Name of the database to drop
    """
    try:
        client = ctx.request_context.lifespan_context.client
        client.drop_database(db_name)
        return {"message": "Database dropped successfully"}
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def explain_aggregate_query(ctx: Context, db_name: str, collection_name: str, pipeline: List[Dict]) -> Dict:
    """
    Explain a query.
    provides information on the execution of the following commands: aggregate
    example col.find(
            {"cuisine":"Italian"},
            {"name" : 1, "address.zipcode" :   1, "address.coord" : 1}
        ).explain()
        or 
        https://www.mongodb.com/community/forums/t/how-to-get-totaldocsexamined-with-explain-in-pymongo/110306/9
        explain_output = db.command('aggregate', 'collection_name', pipeline=agg_pipeline, explain=True)
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        query: Query to explain
        explain_mode: Explain mode (queryPlanner, executionStats, allPlansExecution)
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        explain_output = db.command('aggregate', collection_name, pipeline=pipeline, explain=True)
        return explain_output
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def explain_find_query(ctx: Context, db_name: str, collection_name: str, query: Dict) -> Dict:
    """
    Explain a query.
    provides information on the execution of the following commands: find
    example col.find(
            {"cuisine":"Italian"},
            {"name" : 1, "address.zipcode" :   1, "address.coord" : 1}
        ).explain()
    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        query: Query to explain
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        explain_output = collection.find(query=query).explain()
        return explain_output
    except Exception as e:
        return ErrorResponse(error=str(e))


@mcp.tool()
async def current_ops(ctx: Context, ops: Dict) -> Dict:
    """
    example
    command = {
            "currentOp": True,
            "$or": [
                {"op": "command", "command.createIndexes": {"$exists": True}},
                {"op": "none", "msg": "/^Index Build/"},
            ],
        }


        indexCreatingOps = cls.client.admin.command(command)


    """
    command = {"currentOp": True}
    if ops:
        command.update(ops)
    try:
        client = ctx.request_context.lifespan_context.client
        return client.admin.command(command)
    except Exception as e:
        return ErrorResponse(error=str(e))
