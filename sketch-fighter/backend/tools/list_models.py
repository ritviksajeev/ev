"""Lists the Gemini models your GEMINI_API_KEY can use, so you can pick GEMINI_MODEL.

Reads the key from sketch-fighter/.env like the server does. Run from backend/:
    python -m tools.list_models
"""

import os

import config  # noqa: F401 - loads .env


def main():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        print("No GEMINI_API_KEY found. Put it in sketch-fighter/.env first.")
        return
    from google import genai

    client = genai.Client(api_key=key)
    names = [
        m.name.removeprefix("models/")
        for m in client.models.list()
        if "generateContent" in (m.supported_actions or [])
    ]
    pro = sorted((n for n in names if "pro" in n), reverse=True)
    print("Pro models your key can use:")
    for n in pro or ["(none)"]:
        print("  ", n)
    print(f"\n{len(names)} models in total. Put one name in .env as GEMINI_MODEL=...")
    print("A '-latest' alias, if listed, always points at the newest model of that tier.")


if __name__ == "__main__":
    main()
