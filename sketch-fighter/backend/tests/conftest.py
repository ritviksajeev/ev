import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Stages scanned by tests go to a throwaway folder, never backend/data, and no
# real Gemini call can happen whatever is in a developer's .env.
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="sketch-test-")
os.environ["GEMINI_API_KEY"] = ""
os.environ["GEMINI_MODEL"] = ""
