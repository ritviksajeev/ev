import logging
import time
from types import SimpleNamespace

import pytest
from google.genai import errors

import enrich


@pytest.fixture
def gemini_env(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.setenv("GEMINI_MODEL", "some-pro-model")
    monkeypatch.setenv("GEMINI_TIMEOUT_S", "1")


def test_fallback_without_key():
    t0 = time.perf_counter()
    extras = enrich.enrich(b"jpeg", seed="abc")
    assert extras["source"] == "fallback" and time.perf_counter() - t0 < 0.1
    assert extras == enrich.fallback("abc")  # deterministic per stage


def test_good_answer_is_used(gemini_env, monkeypatch):
    monkeypatch.setattr(enrich, "_ask", lambda *a: {"stageName": "Desk Lamp Duel", "announcerLine": "Lights on, gloves off.", "accentColor": "#FF8800"})
    assert enrich.enrich(b"jpeg", "x") == {
        "stageName": "Desk Lamp Duel", "announcerLine": "Lights on, gloves off.", "accentColor": "#ff8800", "source": "gemini",
    }


def test_bad_fields_are_replaced(gemini_env, monkeypatch):
    monkeypatch.setattr(enrich, "_ask", lambda *a: {"stageName": "x" * 80, "announcerLine": "", "accentColor": "orange"})
    out = enrich.enrich(b"jpeg", "seed")
    base = enrich.fallback("seed")
    assert out["stageName"] == base["stageName"] and out["announcerLine"] == base["announcerLine"]
    assert out["accentColor"] == base["accentColor"]


def test_hanging_model_is_cut_off(gemini_env, monkeypatch):
    monkeypatch.setattr(enrich, "_ask", lambda *a: time.sleep(3) or {})
    t0 = time.perf_counter()
    assert enrich.enrich(b"jpeg", "s")["source"] == "fallback"
    assert time.perf_counter() - t0 < 1.6


def test_errors_never_log_the_key(gemini_env, monkeypatch, caplog):
    def boom(*a):
        raise RuntimeError("request to https://x?key=test-key-123 failed")

    monkeypatch.setattr(enrich, "_ask", boom)
    with caplog.at_level(logging.WARNING, logger="sketch"):
        assert enrich.enrich(b"jpeg", "s")["source"] == "fallback"
    assert "test-key-123" not in caplog.text and "RuntimeError" in caplog.text


def test_thinking_settings_fall_back_in_order(gemini_env, monkeypatch):
    tried = []

    class Models:
        def generate_content(self, model, contents, config):
            think = config.thinking_config
            tried.append(None if think is None else ("level" if think.thinking_level else "budget"))
            if think is not None and think.thinking_level:
                raise errors.ClientError(400, {"error": {"code": 400, "message": "thinking_level not supported", "status": "INVALID_ARGUMENT"}})
            return SimpleNamespace(parsed={"stageName": "Two Desks", "announcerLine": "Go.", "accentColor": "#aabbcc"}, text="")

    monkeypatch.setattr(enrich, "_client", lambda key, timeout: SimpleNamespace(models=Models()))
    assert enrich.enrich(b"jpeg", "s")["stageName"] == "Two Desks"
    assert tried == ["level", "budget"]
