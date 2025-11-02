FROM python:3.11-slim

WORKDIR ./

# Copy requirements first (for caching)
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy rest of the code
COPY . .

EXPOSE 8080
CMD ["python", "main.py"]
