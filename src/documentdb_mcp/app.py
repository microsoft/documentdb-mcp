from mcp.server.fastmcp import FastMCP

from src.documentdb_mcp.mcp_config import HOST, PORT
from src.documentdb_mcp.context_manager import documentdb_lifespan

from src.documentdb_mcp.tools.database import (
    list_databases,
    db_stats,
    get_db_info,
    drop_database,
)

from src.documentdb_mcp.tools.collection import (
    collection_stats,
    rename_collection,
    drop_collection,
)

from src.documentdb_mcp.tools.index import (
    create_index,
    list_indexes,
    drop_index,
    current_ops,
)

from src.documentdb_mcp.tools.document import (
    find_documents,
    count_documents,
    insert_document,
    insert_many,
    update_document,
    update_many,
    delete_document,
    delete_many,
    aggregate,
    explain_aggregate_query,
    explain_find_query,
)


mcp = FastMCP(
    "documentdb-mcp",
    description="MCP server for DocumentDB database operations",
    lifespan=documentdb_lifespan,
    host=HOST,
    port=PORT,
)


# Database tools
mcp.add_tool(list_databases)
mcp.add_tool(db_stats)
mcp.add_tool(get_db_info)
mcp.add_tool(drop_database)

# Collection tools
mcp.add_tool(collection_stats)
mcp.add_tool(rename_collection)
mcp.add_tool(drop_collection)

# Index tools
mcp.add_tool(create_index)
mcp.add_tool(list_indexes)
mcp.add_tool(drop_index)
mcp.add_tool(current_ops)

# Document tools
mcp.add_tool(find_documents)
mcp.add_tool(count_documents)
mcp.add_tool(insert_document)
mcp.add_tool(insert_many)
mcp.add_tool(update_document)
mcp.add_tool(update_many)
mcp.add_tool(delete_document)
mcp.add_tool(delete_many)
mcp.add_tool(aggregate)
mcp.add_tool(explain_aggregate_query)
mcp.add_tool(explain_find_query)