from typing import Dict, List
from mcp.server.fastmcp import Context
from src.documentdb_mcp.models import ErrorResponse, SuccessResponse

async def collection_stats(ctx: Context, db_name: str, collection_name: str) -> Dict:
    """
    Get detailed statistics about a collection's size and storage usage.

    Containing:
    - size: Total data size in bytes
    - count: Number of documents in the collection
    - avgObjSize: Average object size in bytes
    - storageSize: Storage size in bytes
    - nindexes: Number of indexes
    - indexBuilds: Number of indexes currently being built
    - totalIndexSize: Total index size in bytes
    - totalSize: Total size in bytes
    - indexSizes: Dictionary of individual index sizes
    - scaleFactor: Scale factor for size measurements (default=1)

    Note: All size measurements are in bytes when scaleFactor is 1.
    
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

async def drop_collection(ctx: Context, db_name: str, collection_name: str) -> SuccessResponse:
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
        return SuccessResponse(message="Collection dropped successfully")
    except Exception as e:
        return ErrorResponse(error=str(e))
