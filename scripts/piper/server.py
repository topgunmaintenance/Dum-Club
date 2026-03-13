from flask import Flask, request, Response
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route("/synthesize", methods=["POST"])
def synthesize():
    data = request.json
    text = data.get("text", "")
    voice = data.get("voice", "en_US-lessac-medium")
    
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        out_path = f.name
    
    try:
        proc = subprocess.run(
            ["piper", "--model", f"/voices/{voice}.onnx", "--output_file", out_path],
            input=text.encode(),
            capture_output=True
        )
        with open(out_path, "rb") as f:
            audio = f.read()
        return Response(audio, mimetype="audio/wav")
    finally:
        os.unlink(out_path)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5500)
