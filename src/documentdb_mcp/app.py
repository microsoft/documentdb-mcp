from mcp.server.fastmcp import FastMCP, Context
from src.documentdb_mcp.mcp_config import HOST, PORT
from src.documentdb_mcp.context_manager import documentdb_lifespan
from src.documentdb_mcp.models import DBInfoResponse, DocumentQueryResponse, InsertResponse, UpdateResponse, DeleteResponse, AggregateResponse, CreateIndexResponse, ListIndexesResponse, ErrorResponse
from typing import Optional, Dict, Any, List

mcp = FastMCP(
    "documentdb-mcp",
    description="MCP server for DocumentDB database operations",
    lifespan=documentdb_lifespan,
    host=HOST,
    port=PORT
)

@mcp.tool()
async def get_db_info(ctx: Context) -> DBInfoResponse:
    """Get database information including name and collection names."""
    try:
        db = ctx.request_context.lifespan_context.db
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
async def find_documents(ctx: Context, collection_name: str, query: Dict = {}, 
                        limit: int = 100, skip: int = 0) -> DocumentQueryResponse:
    """
    Find documents in a collection using a query.
    
    Args:
        collection_name: Name of the collection to query
        query: Query filter (MongoDB style)
        limit: Maximum number of documents to return
        skip: Number of documents to skip
    """
    try:
        db = ctx.request_context.lifespan_context.db
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
async def insert_document(ctx: Context, collection_name: str, document: Dict) -> InsertResponse:
    """
    Insert a single document into a collection.
    
    Args:
        collection_name: Name of the collection
        document: Document to insert
    """
    try:
        db = ctx.request_context.lifespan_context.db
        collection = db[collection_name]
        result = collection.insert_one(document)
        return InsertResponse(
            inserted_id=str(result.inserted_id),
            acknowledged=result.acknowledged,
            inserted_count=1
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def insert_many(ctx: Context, collection_name: str, documents: List[Dict]) -> InsertResponse:
    """
    Insert multiple documents into a collection.
    
    Args:
        collection_name: Name of the collection
        documents: List of documents to insert
    """
    try:
        db = ctx.request_context.lifespan_context.db
        collection = db[collection_name]
        result = collection.insert_many(documents)
        return InsertResponse(
            inserted_ids=[str(id) for id in result.inserted_ids],
            acknowledged=result.acknowledged,
            inserted_count=len(result.inserted_ids)
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def update_document(ctx: Context, collection_name: str, filter: Dict, 
                         update: Dict, upsert: bool = False) -> UpdateResponse:
    """
    Update a document in a collection.
    
    Args:
        collection_name: Name of the collection
        filter: Query filter to find the document
        update: Update operations ($set, $inc, etc.)
        upsert: Create document if it doesn't exist
    """
    try:
        db = ctx.request_context.lifespan_context.db
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
async def delete_document(ctx: Context, collection_name: str, filter: Dict) -> DeleteResponse:
    """
    Delete a document from a collection.
    
    Args:
        collection_name: Name of the collection
        filter: Query filter to find the document
    """
    try:
        db = ctx.request_context.lifespan_context.db
        collection = db[collection_name]
        result = collection.delete_one(filter)
        return DeleteResponse(
            deleted_count=result.deleted_count,
            acknowledged=result.acknowledged
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def aggregate(ctx: Context, collection_name: str, pipeline: List[Dict], 
                   allow_disk_use: bool = False) -> AggregateResponse:
    """
    Run an aggregation pipeline on a collection.
    
    Args:
        collection_name: Name of the collection
        pipeline: List of aggregation stages
        allow_disk_use: Allow pipeline stages to write to disk
    """
    try:
        db = ctx.request_context.lifespan_context.db
        collection = db[collection_name]
        results = list(collection.aggregate(pipeline, allowDiskUse=allow_disk_use))
        return AggregateResponse(
            results=results,
            total_count=len(results)
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

@mcp.tool()
async def create_index(ctx: Context, collection_name: str, keys: Dict, 
                      unique: bool = False, name: Optional[str] = None) -> Dict:
    """
    Create an index on a collection.
    
    Args:
        collection_name: Name of the collection
        keys: Dictionary defining the index (e.g., {'field': 1} for ascending)
        unique: Whether the index should be unique
        name: Optional name for the index
    """
    try:
        db = ctx.request_context.lifespan_context.db
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
async def list_indexes(ctx: Context, collection_name: str) -> List[Dict]:
    """
    List all indexes on a collection.
    
    Args:
        collection_name: Name of the collection
    """
    try:
        db = ctx.request_context.lifespan_context.db
        collection = db[collection_name]
        indexes = list(collection.list_indexes())
        return ListIndexesResponse(indexes=indexes)
    except Exception as e:
        return ErrorResponse(error=str(e))