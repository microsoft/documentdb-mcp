# Steps for Setting Up Index Advisor with Github Copilot
This guide provides instructions for setting up the Index Advisor MVP. **Currently, it is required to run on Windows**, but support for additional operating systems will be added soon.

## Prerequisites
- Python is required for setting up the MVP. We use `uv` for project management.
- Install the `GitHub Copilot` extension in VS Code.

## Install Dependencies
Navigate to the project directory and run the following commands to install the dependencies:
```
pip install uv
uv venv
uv pip install -e .
```

## Configure Environment Variables
Create and modify the `.env` file at the root of the project:
```
cp .env.example .env
# In MVP, we use 'streamable-http' mode
# Need to config your connection string in `.env` file to connect your testing cluster
```

## Start MCP Server
Run the following command to start the MCP server locally:
```
uv run .\src\documentdb_mcp\main.py
```

## Configuration Instructions
In VS Code, open the Profiles editor by navigating to `File -> Preferences -> Profile -> Profiles`.
![Access Profiles Editor](/pics/Accessing_Profiles_Editor.png)

Double-click `Settings` to edit the `settings.json` file and add the following block:
```
// The codeGeneration is deprecating and is migrating to instruction files
// We only use this filed to set up MVP
"github.copilot.chat.codeGeneration.instructions": [
        {
            "text": "When answering questions about queries, **always retrieve real data from the database** using the provided MCP tools."
        },
        {
            "text": "**Never invent or assume data** if it is not in context."
        },
        {
            "text": "Suggest **Considering enable Index-Only scan feature to improve the performance** when optimize count operation"
        }
    ],
    "chat.mcp.autostart": true
```
![Edit Profile Settings](/pics/Edit_Settings_File.png)

## Configure the MCP Server
Double-click MCP Servers in the Profiles editor to edit the `mcp.json` file:
```
{
  "servers": {
    "documentDB": {
      "url": "http://localhost:8070/mcp",
      "type": "http"
    }
  },
  "inputs": []
}
```
![Edit MCP Servers](/pics/Edit_MCP_Servers.png)

Start the server defined in the `mcp.json` file
![Start MCP Server](/pics/Start_MCP_Server.png)

## Confirm the DocumentDB MCP is Selected
Open the GitHub Copilot chat window and verify that the DocumentDB MCP server is selected.
![Verify MCP Server Selected](/pics/Confirm_MCP_Selected.png)

**NOTE**: It is highly recommended to uncheck unused MCP servers and tools to improve the performance and stability of the Index Advisor.

## Done
Everything is set up! You can now try out the Index Advisor.