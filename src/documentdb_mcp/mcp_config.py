import os

from dotenv import load_dotenv

load_dotenv()

TRANSPORT = os.getenv("TRANSPORT", "streamable-http")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8050"))
DOCUMENTDB_URI = os.getenv("DOCUMENTDB_URI", "mongodb://localhost:27017")