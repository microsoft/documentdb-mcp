from mcp.server.fastmcp import FastMCP

from src.documentdb_mcp.context_manager import documentdb_lifespan
from src.documentdb_mcp.mcp_config import HOST, PORT
from src.documentdb_mcp.tools.analysis import (
    check_plotly_availability,
    create_plotly_bar_chart,
    create_plotly_histogram,
    create_plotly_scatter,
    create_plotly_time_series,
    get_analysis_prompt,
    get_documentdb_operations_prompt,
    get_field_statistics,
)
from src.documentdb_mcp.tools.collection import (
    collection_stats,
    drop_collection,
    rename_collection,
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
    find_and_modify,
    find_documents,
    insert_document,
    insert_many,
    update_document,
    update_many,
)
from src.documentdb_mcp.tools.index import (
    create_index,
    current_ops,
    drop_index,
    list_indexes,
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
mcp.add_tool(find_and_modify)
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

# Analysis and plotting tools
mcp.add_tool(check_plotly_availability)
mcp.add_tool(get_analysis_prompt)
mcp.add_tool(get_documentdb_operations_prompt)
mcp.add_tool(get_field_statistics)
mcp.add_tool(create_plotly_histogram)
mcp.add_tool(create_plotly_scatter)
mcp.add_tool(create_plotly_bar_chart)
mcp.add_tool(create_plotly_time_series)
