SHELL := /bin/bash
PYTHON ?= python3
VENV := .venv
PORT ?= 5050

.PHONY: help venv install dev clean

help:
	@echo "Targets:"
	@echo "  make venv     - create virtualenv"
	@echo "  make install  - install requirements into venv"
	@echo "  make dev      - run uvicorn app:app --reload --port $(PORT)"
	@echo "  make clean    - remove .venv"

venv:
	@if [ ! -d "$(VENV)" ]; then \
		echo "Creating virtualenv at $(VENV)"; \
		$(PYTHON) -m venv $(VENV); \
	fi

install: venv
	. $(VENV)/bin/activate && pip install -r requirements.txt

dev: install
	. $(VENV)/bin/activate && PYTHONUNBUFFERED=1 uvicorn app:app --reload --port $(PORT)

clean:
	rm -rf $(VENV)
