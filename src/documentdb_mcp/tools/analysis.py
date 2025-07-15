from typing import Any, Dict, Optional

import pandas as pd
from mcp.server.fastmcp import Context
from mcp.types import GetPromptResult, PromptMessage, TextContent

try:
    import plotly.express as px
    import plotly.graph_objects as go
    PLOTLY_AVAILABLE = True
except ImportError:
    PLOTLY_AVAILABLE = False

from src.documentdb_mcp.models import ErrorResponse

# DocumentDB Operations Prompt Template
DOCUMENTDB_OPERATIONS_PROMPT_TEMPLATE = """
You are a DocumentDB specialist focused on safe, conservative database exploration and operations.

**Core Principles:**
- ALWAYS start with simple, single operations using minimal data
- Use small limits (5-10 documents) for initial exploration
- Suggest potential next steps rather than executing complex sequences
- Avoid nested or chained operations in a single response

**Best Practices:**

1. **Safety First:**
   - Always test operations on small datasets first
   - Use `find_documents` with limit=10 to sample data structure
   - Validate filters and queries before bulk operations
   - Double-check destructive operations (drop, delete)

2. **Performance Optimization:**
   - Create appropriate indexes before large queries
   - Use `explain_find_query` to check if queries use indexes
   - Limit result sets to manageable sizes
   - Use aggregation pipelines for complex data transformations

3. **Suggest Next Steps:**
   Instead of doing everything at once, suggest options like:
   - "Would you like to see more documents from this collection?"
   - "Should we explore the data structure of another collection?"
   - "Would you like to see statistics for a specific field?"
   - "Should we check for data patterns in a particular area?"

**Workflow Pattern:**
1. Single simple operation (explore/sample)
2. Present findings clearly
3. Suggest 2-3 possible next exploration steps
4. Wait for user direction before proceeding

Remember: Always use the MCP tools directly. Avoid writing Python scripts or shell commands when MCP tools can accomplish the task. 
Be conservative, be helpful, suggest rather than assume what to do next.
"""

# Data Analysis Prompt Template  
DATA_ANALYSIS_PROMPT_TEMPLATE = """
You are a professional Data Scientist conducting exploratory data analysis on DocumentDB datasets. Your focus is on extracting insights from data that has already been fetched or queried from the database.

Your analysis should focus on the following topic: {topic}

**Analysis Framework:**

1. **Data Assessment** 
   Before diving into analysis, assess the fetched data:
   - Examine data structure and types using `find_documents` (limit=10)
   - Check data quality and completeness with `count_documents`
   - Identify key fields relevant to your analysis topic: {topic}
   - Note any data quality issues (missing values, outliers, inconsistencies)

2. **Exploratory Questions**
   Formulate 3-5 specific, answerable questions related to: {topic}
   Examples:
   - What are the distributions of key numeric variables?
   - Are there patterns or trends in categorical data?
   - What correlations exist between different fields?
   - How does the data vary over time (if temporal data exists)?
   - What are the outliers or anomalies in the dataset?

3. **Statistical Analysis**
   For each question, use appropriate MCP tools:
   - `get_field_statistics` for numeric field summaries (mean, min, max, count)
   - `aggregate` with grouping for categorical analysis
   - `count_documents` with filters for subset analysis
   - Apply reasonable limits (≤100 documents) for manageable results

4. **Data Visualization**
   Create informative visualizations using the plotting tools:
   - `create_plotly_histogram` - Distribution analysis of numeric fields
   - `create_plotly_bar_chart` - Categorical data and value counts  
   - `create_plotly_scatter` - Relationships between numeric variables
   - `create_plotly_time_series` - Temporal patterns and trends

5. **Pattern Recognition**
   Look for meaningful patterns in the data:
   - Identify trends, seasonality, or cyclical patterns
   - Spot outliers and investigate their significance
   - Find correlations and relationships between variables
   - Discover segments or clusters in the data

6. **Insights & Recommendations**
   Synthesize findings into actionable insights:
   - Key discoveries related to: {topic}
   - Data-driven recommendations
   - Areas for further investigation
   - Limitations and caveats of the analysis

**Best Practices:**
- Start small (limit=20-50) then scale as patterns emerge
- Check for missing values and validate data types before analysis
- Choose appropriate plot types and use clear titles related to {topic}
- Report sample sizes and distinguish correlation from causation
- Connect findings back to the analysis topic and provide actionable recommendations

**Example Workflow:**
1. `find_documents` (limit=10) → Understand data structure
2. `count_documents` → Assess dataset size  
3. `get_field_statistics` on key numeric fields
4. Create visualizations for key patterns
5. Synthesize insights related to: {topic}

Remember: Focus on extracting meaningful insights from the data. Use visualizations to tell the story of your findings related to {topic}.
"""


async def get_documentdb_operations_prompt(
    ctx: Context
) -> Dict[str, str]:
    """Get the DocumentDB operations prompt template.

    Returns:
        Dictionary containing the formatted prompt template with metadata
    """
    try:
        return {
            "prompt": DOCUMENTDB_OPERATIONS_PROMPT_TEMPLATE,
            "template_version": "2.1",
            "description": "DocumentDB operations guide using MCP tools",
            "focus": "database_operations",
            "best_practices_included": True
        }
    except Exception as e:
        return ErrorResponse(error=f"Failed to get DocumentDB operations prompt: {str(e)}")


async def get_analysis_prompt(
    ctx: Context,
    topic: str = "general data exploration"
) -> Dict[str, str]:
    """Get the enhanced data analysis prompt template with specified topic.

    Args:
        topic: Analysis topic to focus on (e.g., "sales trends", "customer behavior", "inventory analysis")

    Returns:
        Dictionary containing the formatted prompt template with metadata
    """
    try:
        formatted_prompt = DATA_ANALYSIS_PROMPT_TEMPLATE.format(topic=topic)
        return {
            "prompt": formatted_prompt,
            "topic": topic,
            "template_version": "2.1",
            "description": f"Streamlined data analysis guide focused on: {topic}",
            "focus": "data_analysis",
            "best_practices_included": True
        }
    except Exception as e:
        return ErrorResponse(error=f"Failed to format prompt: {str(e)}")


def create_documentdb_operations_prompt(
    name: str,
    arguments: Dict[str, Any] | None = None
) -> GetPromptResult:
    """Create a streamlined DocumentDB operations prompt for database management.
    
    This prompt provides focused guidance for DocumentDB operations
    using the available MCP tools, emphasizing safety and best practices.
    """
    return GetPromptResult(
        description="Streamlined DocumentDB operations guide using MCP tools",
        messages=[
            PromptMessage(
                role="user",
                content=TextContent(
                    type="text", 
                    text=DOCUMENTDB_OPERATIONS_PROMPT_TEMPLATE
                )
            )
        ]
    )


def create_data_analysis_prompt(
    name: str,
    arguments: Dict[str, Any] | None = None
) -> GetPromptResult:
    """Create a streamlined data analysis prompt for DocumentDB data exploration.
    
    This prompt provides a focused, step-by-step guide to analyzing DocumentDB data
    using the available MCP tools. It emphasizes best practices and direct tool usage.
    
    Arguments:
        topic (optional): Specific analysis topic to focus on
                         Examples: "sales trends", "customer behavior", "inventory analysis"
                         Default: "general data exploration"
    """
    # Extract topic from arguments, default to general exploration
    topic = "general data exploration"
    if arguments and "topic" in arguments:
        topic = str(arguments["topic"]).strip()
        if not topic:
            topic = "general data exploration"
    
    # Format the comprehensive prompt template
    formatted_prompt = DATA_ANALYSIS_PROMPT_TEMPLATE.format(topic=topic)
    
    return GetPromptResult(
        description=f"Streamlined DocumentDB data analysis guide focused on: {topic}",
        messages=[
            PromptMessage(
                role="user",
                content=TextContent(
                    type="text", 
                    text=formatted_prompt
                )
            )
        ]
    )


async def create_plotly_histogram(
    ctx: Context,
    db_name: str,
    collection_name: str,
    field: str,
    query: Dict[str, Any] = None,
    bins: int = 30,
    title: Optional[str] = None
) -> Dict[str, Any]:
    """Create a Plotly histogram from DocumentDB collection data.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        field: Field to create histogram for
        query: MongoDB query filter (optional)
        bins: Number of histogram bins
        title: Custom title for the plot

    Returns:
        Dictionary containing Plotly JSON and metadata
    """
    if not PLOTLY_AVAILABLE:
        return ErrorResponse(error="Plotly is not available. Please install plotly.")

    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]

        # Build aggregation pipeline
        pipeline = []
        if query:
            pipeline.append({"$match": query})

        pipeline.extend([
            {"$project": {field: 1}},
            {"$match": {field: {"$exists": True, "$ne": None}}}
        ])

        # Get data
        cursor = collection.aggregate(pipeline)
        data = [doc[field] for doc in cursor if field in doc and doc[field] is not None]

        if not data:
            return ErrorResponse(error=f"No data found for field '{field}'")

        # Create Plotly histogram
        fig = go.Figure(data=[go.Histogram(x=data, nbinsx=bins)])
        fig.update_layout(
            title=title or f'Histogram of {field}',
            xaxis_title=field,
            yaxis_title='Frequency',
            showlegend=False
        )

        return {
            "plotly_json": fig.to_json(),
            "data_points": len(data),
            "field": field,
            "chart_type": "histogram"
        }

    except Exception as e:
        return ErrorResponse(error=f"Failed to create histogram: {str(e)}")


async def create_plotly_scatter(
    ctx: Context,
    db_name: str,
    collection_name: str,
    x_field: str,
    y_field: str,
    query: Dict[str, Any] = None,
    color_field: Optional[str] = None,
    title: Optional[str] = None
) -> Dict[str, Any]:
    """Create a Plotly scatter plot from DocumentDB collection data.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        x_field: Field for X-axis
        y_field: Field for Y-axis
        query: MongoDB query filter (optional)
        color_field: Field to use for color coding (optional)
        title: Custom title for the plot

    Returns:
        Dictionary containing Plotly JSON and metadata
    """
    if not PLOTLY_AVAILABLE:
        return ErrorResponse(error="Plotly is not available. Please install plotly.")

    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]

        # Build aggregation pipeline
        pipeline = []
        if query:
            pipeline.append({"$match": query})

        fields_to_project = {x_field: 1, y_field: 1}
        if color_field:
            fields_to_project[color_field] = 1

        pipeline.extend([
            {"$project": fields_to_project},
            {"$match": {
                x_field: {"$exists": True, "$ne": None},
                y_field: {"$exists": True, "$ne": None}
            }}
        ])

        # Get data
        cursor = collection.aggregate(pipeline)
        docs = list(cursor)

        if not docs:
            return ErrorResponse(error=f"No data found for fields '{x_field}' and '{y_field}'")

        # Create DataFrame
        df = pd.DataFrame(docs)

        # Create Plotly scatter plot
        if color_field and color_field in df.columns:
            fig = px.scatter(df, x=x_field, y=y_field, color=color_field,
                           title=title or f'{y_field} vs {x_field}')
        else:
            fig = px.scatter(df, x=x_field, y=y_field,
                           title=title or f'{y_field} vs {x_field}')

        return {
            "plotly_json": fig.to_json(),
            "data_points": len(docs),
            "x_field": x_field,
            "y_field": y_field,
            "chart_type": "scatter"
        }

    except Exception as e:
        return ErrorResponse(error=f"Failed to create scatter plot: {str(e)}")


async def create_plotly_bar_chart(
    ctx: Context,
    db_name: str,
    collection_name: str,
    field: str,
    query: Dict[str, Any] = None,
    limit: int = 20,
    title: Optional[str] = None
) -> Dict[str, Any]:
    """Create a Plotly bar chart showing value counts from DocumentDB collection data.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        field: Field to create bar chart for
        query: MongoDB query filter (optional)
        limit: Maximum number of bars to show
        title: Custom title for the plot

    Returns:
        Dictionary containing Plotly JSON and metadata
    """
    if not PLOTLY_AVAILABLE:
        return ErrorResponse(error="Plotly is not available. Please install plotly.")

    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]

        # Build aggregation pipeline for value counts
        pipeline = []
        if query:
            pipeline.append({"$match": query})

        pipeline.extend([
            {"$match": {field: {"$exists": True, "$ne": None}}},
            {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": limit}
        ])

        # Get data
        cursor = collection.aggregate(pipeline)
        data = list(cursor)

        if not data:
            return ErrorResponse(error=f"No data found for field '{field}'")

        # Create Plotly bar chart
        values = [str(doc["_id"]) for doc in data]
        counts = [doc["count"] for doc in data]

        fig = go.Figure(data=[go.Bar(x=values, y=counts)])
        fig.update_layout(
            title=title or f'Value Counts for {field}',
            xaxis_title=field,
            yaxis_title='Count',
            showlegend=False
        )

        return {
            "plotly_json": fig.to_json(),
            "data_points": len(data),
            "field": field,
            "chart_type": "bar"
        }

    except Exception as e:
        return ErrorResponse(error=f"Failed to create bar chart: {str(e)}")


async def create_plotly_time_series(
    ctx: Context,
    db_name: str,
    collection_name: str,
    date_field: str,
    value_field: str,
    query: Dict[str, Any] = None,
    aggregation: str = "daily",
    title: Optional[str] = None
) -> Dict[str, Any]:
    """Create a Plotly time series plot from DocumentDB collection data.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        date_field: Field containing date/datetime values
        value_field: Field containing values to plot
        query: MongoDB query filter (optional)
        aggregation: Time aggregation level ("daily", "weekly", "monthly")
        title: Custom title for the plot

    Returns:
        Dictionary containing Plotly JSON and metadata
    """
    if not PLOTLY_AVAILABLE:
        return ErrorResponse(error="Plotly is not available. Please install plotly.")

    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]

        # Build aggregation pipeline
        pipeline = []
        if query:
            pipeline.append({"$match": query})

        # Date grouping based on aggregation level
        if aggregation == "daily":
            date_group = {
                "year": {"$year": f"${date_field}"},
                "month": {"$month": f"${date_field}"},
                "day": {"$dayOfMonth": f"${date_field}"}
            }
        elif aggregation == "weekly":
            date_group = {
                "year": {"$year": f"${date_field}"},
                "week": {"$week": f"${date_field}"}
            }
        elif aggregation == "monthly":
            date_group = {
                "year": {"$year": f"${date_field}"},
                "month": {"$month": f"${date_field}"}
            }
        else:
            return ErrorResponse(error="Aggregation must be 'daily', 'weekly', or 'monthly'")

        pipeline.extend([
            {"$match": {
                date_field: {"$exists": True, "$ne": None},
                value_field: {"$exists": True, "$ne": None}
            }},
            {"$group": {
                "_id": date_group,
                "total": {"$sum": f"${value_field}"},
                "avg": {"$avg": f"${value_field}"},
                "count": {"$sum": 1}
            }},
            {"$sort": {"_id": 1}}
        ])

        # Get data
        cursor = collection.aggregate(pipeline)
        data = list(cursor)

        if not data:
            return ErrorResponse(error=f"No data found for fields '{date_field}' and '{value_field}'")

        # Create time series data
        dates = []
        values = []

        for doc in data:
            date_info = doc["_id"]
            if aggregation == "daily":
                date_str = f"{date_info['year']}-{date_info['month']:02d}-{date_info['day']:02d}"
            elif aggregation == "weekly":
                date_str = f"{date_info['year']}-W{date_info['week']:02d}"
            elif aggregation == "monthly":
                date_str = f"{date_info['year']}-{date_info['month']:02d}"

            dates.append(date_str)
            values.append(doc["total"])

        # Create Plotly time series plot
        fig = go.Figure(data=[go.Scatter(x=dates, y=values, mode='lines+markers')])
        fig.update_layout(
            title=title or f'{value_field} over time ({aggregation})',
            xaxis_title='Date',
            yaxis_title=value_field,
            showlegend=False
        )

        return {
            "plotly_json": fig.to_json(),
            "data_points": len(data),
            "date_field": date_field,
            "value_field": value_field,
            "chart_type": "time_series"
        }

    except Exception as e:
        return ErrorResponse(error=f"Failed to create time series plot: {str(e)}")


async def get_field_statistics(
    ctx: Context,
    db_name: str,
    collection_name: str,
    field: str,
    query: Dict[str, Any] = None
) -> Dict[str, Any]:
    """Get statistical summary of a numeric field in a DocumentDB collection.

    Args:
        db_name: Name of the database
        collection_name: Name of the collection
        field: Field to analyze
        query: MongoDB query filter (optional)

    Returns:
        Dictionary containing statistical measures
    """
    try:
        client = ctx.request_context.lifespan_context.client
        db = client[db_name]
        collection = db[collection_name]

        # Build aggregation pipeline
        pipeline = []
        if query:
            pipeline.append({"$match": query})

        pipeline.extend([
            {"$match": {field: {"$exists": True, "$ne": None, "$type": "number"}}},
            {"$group": {
                "_id": None,
                "count": {"$sum": 1},
                "min": {"$min": f"${field}"},
                "max": {"$max": f"${field}"},
                "avg": {"$avg": f"${field}"},
                "sum": {"$sum": f"${field}"}
            }}
        ])

        # Get basic statistics
        cursor = collection.aggregate(pipeline)
        result = next(cursor, None)

        if not result:
            return ErrorResponse(error=f"No numeric data found for field '{field}'")

        return {
            "field": field,
            "count": result["count"],
            "min": result["min"],
            "max": result["max"],
            "mean": result["avg"],
            "sum": result["sum"],
            "range": result["max"] - result["min"]
        }

    except Exception as e:
        return ErrorResponse(error=f"Failed to get field statistics: {str(e)}")


async def check_plotly_availability(ctx: Context) -> Dict[str, Any]:
    """Check if Plotly library is available.

    Returns:
        Dictionary with availability status and version info
    """
    try:
        if PLOTLY_AVAILABLE:
            import plotly
            return {
                "plotly_available": True,
                "plotly_version": plotly.__version__,
                "message": "Plotly is available for creating interactive visualizations"
            }
        else:
            return {
                "plotly_available": False,
                "message": "Plotly is not available. Please install plotly to enable visualization functions"
            }
    except Exception as e:
        return ErrorResponse(error=f"Failed to check Plotly availability: {str(e)}")


