from typing import List
from mcp.server.fastmcp import Context
from src.documentdb_mcp.models import ErrorResponse

async def list_databases(ctx: Context) -> List[str]:
    """List all databases in the DocumentDB instance."""
    try:
        client = ctx.request_context.lifespan_context.client
        return client.list_database_names()
    except Exception as e:
        return ErrorResponse(error=str(e))