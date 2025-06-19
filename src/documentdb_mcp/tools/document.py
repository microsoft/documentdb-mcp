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


async def find_documents(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query: Dict = {},
    limit: int = 100,
    skip: int = 0,
) -> DocumentQueryResponse:
    """Find documents in a collection using a query.

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
        total_count = (
            collection.estimated_document_count()
            if not query
            else collection.count_documents(query)
        )

        return DocumentQueryResponse(
            documents=documents,
            total_count=total_count,
            limit=limit,
            skip=skip,
            has_more=(skip + len(documents)) < total_count,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def find_and_modify(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query: Dict,
    update: Dict,
    upsert: bool = False,
) -> DocumentQueryResponse:
    """Find and modify a document in a collection.
        Will return the document before the update if it exists, or None if it doesn't.
    Args:
        db_name: Name of the database
        collection_name: Name of the collection to query
        query: Query filter (MongoDB style)
        update: Update operations ($set, $inc, etc.)
        upsert: Create document if it doesn't exist
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        result = collection.find_one_and_update(query, update, upsert=upsert)

        return result
    except Exception as e:
        return ErrorResponse(error=str(e))

async def count_documents(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query: Dict = {},
) -> int:
    """Count the number of documents in a collection.

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

async def insert_document(
    ctx: Context,
    db_name: str,
    collection_name: str,
    document: Dict,
) -> InsertOneResponse:
    """Insert a single document into a collection.

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
            inserted_count=1,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def insert_many(
    ctx: Context,
    db_name: str,
    collection_name: str,
    documents: List[Dict],
) -> InsertManyResponse:
    """Insert multiple documents into a collection.

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
            inserted_count=len(result.inserted_ids),
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def update_document(
    ctx: Context,
    db_name: str,
    collection_name: str,
    filter: Dict,
    update: Dict,
    upsert: bool = False,
) -> UpdateResponse:
    """Update a document in a collection.

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
            acknowledged=result.acknowledged,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def update_many(
    ctx: Context,
    db_name: str,
    collection_name: str,
    filter: Dict,
    update: Dict,
    upsert: bool = False,
) -> UpdateResponse:
    """Update multiple documents in a collection.

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
            acknowledged=result.acknowledged,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def delete_document(
    ctx: Context,
    db_name: str,
    collection_name: str,
    filter: Dict,
) -> DeleteResponse:
    """Delete a document from a collection.

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
            acknowledged=result.acknowledged,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

async def delete_many(
    ctx: Context,
    db_name: str,
    collection_name: str,
    filter: Dict,
) -> DeleteResponse:
    """Delete multiple documents from a collection.

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
            acknowledged=result.acknowledged,
        )
    except Exception as e:
        return ErrorResponse(error=str(e))

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

async def explain_aggregate_query(
    ctx: Context,
    db_name: str,
    collection_name: str,
    pipeline: List[Dict],
) -> dict:
    """Explain the execution plan for an aggregation query on a given collection.

    Useful for analyzing performance (e.g. COLLSCAN vs IDXSCAN) or debugging
    vector search queries. Internally runs:
        db.command('aggregate', collection, pipeline=..., explain=True)

    Args:
        db_name: Database name.
        collection_name: Collection name.
        pipeline: Aggregation pipeline to explain.
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        explain_output = db.command(
            "aggregate",
            collection_name,
            pipeline=pipeline,
            explain=True,
        )
        return explain_output
    except Exception as e:
        return ErrorResponse(error=str(e))

async def explain_find_query(
    ctx: Context,
    db_name: str,
    collection_name: str,
    query: Dict,
) -> dict:
    """Explain the execution plan for a find query.

    Example:
        collection.find({"cuisine": "Italian"}).explain()

    Args:
        db_name: Database name.
        collection_name: Collection name.
        query: Filter query to explain.
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]
        explain_output = collection.find(query).explain()
        return explain_output
    except Exception as e:
        return ErrorResponse(error=str(e))
