from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from pymongo import MongoClient
from src.documentdb_mcp.models import DocumentDBContext
from mcp.server.fastmcp import FastMCP
from src.documentdb_mcp.mcp_config import DOCUMENTDB_URI

@asynccontextmanager
async def documentdb_lifespan(server: FastMCP) -> AsyncIterator["DocumentDBContext"]:
    """Manages the DocumentDB client lifecycle."""
    try:
        client = MongoClient(DOCUMENTDB_URI)
        yield DocumentDBContext(client=client)
    finally:
        client.close()
