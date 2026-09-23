FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY online_service/requirements.txt /app/online_service/requirements.txt
RUN pip install --no-cache-dir -r /app/online_service/requirements.txt

COPY online_service /app/online_service
COPY mobile-controller.html /app/mobile-controller.html

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/health', timeout=3)"

CMD ["python", "-m", "uvicorn", "online_service.app:app", "--host", "0.0.0.0", "--port", "8787", "--workers", "1", "--proxy-headers"]

