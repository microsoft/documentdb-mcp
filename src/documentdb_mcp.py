from mcp.server.fastmcp import FastMCP, Context
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from dataclasses import dataclass
from dotenv import load_dotenv
from pymongo import MongoClient
import asyncio
import os
from typing import Optional, Dict, Any, List
import json

load_dotenv()

# Database configuration
DOCUMENTDB_URI = os.getenv("DOCUMENTDB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "database")

@dataclass
class DocumentDBContext:
    """Context for the DocumentDB MCP server."""
    db: MongoClient

@asynccontextmanager
async def documentdb_lifespan(server: FastMCP) -> AsyncIterator[DocumentDBContext]:
    """Manages the DocumentDB client lifecycle."""
    try:
        client = MongoClient(DOCUMENTDB_URI)
        db = client[DB_NAME]
        yield DocumentDBContext(db=db)
    finally:
        client.close()

mcp = FastMCP(
    "documentdb-mcp",
    description="MCP server for DocumentDB database operations",
    lifespan=documentdb_lifespan,
    host=os.getenv("HOST", "0.0.0.0"),
    port=os.getenv("PORT", "8050")
)

@mcp.tool()
async def get_db_info(ctx: Context) -> Dict[str, Any]:
    """Get database information including name and collection names."""
    try:
        db = ctx.request_context.lifespan_context.db
        return {
            "database_name": db.name,
            "collection_names": db.list_collection_names(),
            "stats": {
                "collections": len(db.list_collection_names()),
            "estimated total count": sum(db[collection_name].estimated_document_count() 
                                 for collection_name in db.list_collection_names())
            }
        }
    except Exception as e:
        return {"error": str(e)}

@mcp.tool()
async def find_documents(ctx: Context, collection_name: str, query: Dict = {}, 
                        limit: int = 100, skip: int = 0) -> Dict[str, Any]:
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
        
        # Execute query with pagination
        cursor = collection.find(query).skip(skip).limit(limit)
        documents = list(cursor)
        
        # Get total count for pagination using estimated count
        total_count = collection.estimated_document_count() if not query else collection.count_documents(query)
        
        return {
            "documents": documents,
            "total_count": total_count,
            "limit": limit,
            "skip": skip,
            "has_more": (skip + len(documents)) < total_count
        }
    except Exception as e:
        return {"error": str(e)}

@mcp.tool()
async def insert_document(ctx: Context, collection_name: str, document: Dict) -> Dict:
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
        return {
            "inserted_id": str(result.inserted_id),
            "acknowledged": result.acknowledged,
            "inserted_count": 1
        }
    except Exception as e:
        return {"error": str(e)}

@mcp.tool()
async def insert_many(ctx: Context, collection_name: str, documents: List[Dict]) -> Dict:
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
        return {
            "inserted_ids": [str(id) for id in result.inserted_ids],
            "acknowledged": result.acknowledged,
            "inserted_count": len(result.inserted_ids)
        }
    except Exception as e:
        return {"error": str(e)}

@mcp.tool()
async def update_document(ctx: Context, collection_name: str, filter: Dict, 
                         update: Dict, upsert: bool = False) -> Dict:
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
        return {
            "matched_count": result.matched_count,
            "modified_count": result.modified_count,
            "upserted_id": str(result.upserted_id) if result.upserted_id else None,
            "acknowledged": result.acknowledged
        }
    except Exception as e:
        return {"error": str(e)}

@mcp.tool()
async def delete_document(ctx: Context, collection_name: str, filter: Dict) -> Dict:
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
        return {
            "deleted_count": result.deleted_count,
            "acknowledged": result.acknowledged
        }
    except Exception as e:
        return {"error": str(e)}

@mcp.tool()
async def aggregate(ctx: Context, collection_name: str, pipeline: List[Dict], 
                   allow_disk_use: bool = False) -> Dict[str, Any]:
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
        
        # Execute aggregation with optional disk use
        results = list(collection.aggregate(
            pipeline,
            allowDiskUse=allow_disk_use
        ))
        
        return {
            "results": results,
            "count": len(results)
        }
    except Exception as e:
        return {"error": str(e)}

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
        
        return {
            "index_name": index_name,
            "keys": keys,
            "unique": unique
        }
    except Exception as e:
        return {"error": str(e)}

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
        return list(collection.list_indexes())
    except Exception as e:
        return [{"error": str(e)}]

async def main():
    transport = os.getenv("TRANSPORT", "sse")
    if transport == 'sse':
        await mcp.run_sse_async()
    else:
        await mcp.run_stdio_async()

if __name__ == "__main__":
    asyncio.run(main())
