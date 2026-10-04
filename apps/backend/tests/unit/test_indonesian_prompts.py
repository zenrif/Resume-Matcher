"""Test Indonesian prompt formatting and language support (Phase 6a)."""

import pytest

from app.prompts import (
    templates,
    enrichment,
    resume_wizard,
)
from app.routers.config import SUPPORTED_LANGUAGES
from app.schemas.models import LanguageConfigResponse
from app.services.resume_wizard_copy import _COPY, wizard_copy


def test_indonesian_language_name():
    assert templates.get_language_name("id") == "Indonesian (Bahasa Indonesia)"


def test_indonesian_in_supported_languages():
    assert "id" in SUPPORTED_LANGUAGES
    resp = LanguageConfigResponse()
    assert "id" in resp.supported_languages


def test_indonesian_wizard_copy_keys():
    en_keys = set(_COPY["en"].keys())
    id_keys = set(_COPY["id"].keys())
    assert id_keys == en_keys
    for k in en_keys:
        assert isinstance(_COPY["id"][k], str)
        assert len(_COPY["id"][k]) > 0
        assert wizard_copy("id", k) == _COPY["id"][k]


def test_prompt_formatting_with_indonesian():
    lang_name = templates.get_language_name("id")
    assert lang_name == "Indonesian (Bahasa Indonesia)"

    # Test templates prompts
    prompt_list = [
        (templates.IMPROVE_RESUME_PROMPT_NUDGE, {
            "critical_truthfulness_rules": "rules",
            "output_language": lang_name,
            "job_description": "Sample Job",
            "job_keywords": "python",
            "original_resume": "{}",
            "schema": "{}",
        }),
        (templates.IMPROVE_RESUME_PROMPT_KEYWORDS, {
            "critical_truthfulness_rules": "rules",
            "output_language": lang_name,
            "job_description": "Sample Job",
            "job_keywords": "python",
            "original_resume": "{}",
            "schema": "{}",
        }),
        (templates.IMPROVE_RESUME_PROMPT_FULL, {
            "critical_truthfulness_rules": "rules",
            "output_language": lang_name,
            "job_description": "Sample Job",
            "job_keywords": "python",
            "original_resume": "{}",
            "schema": "{}",
        }),
        (templates.COVER_LETTER_PROMPT, {
            "output_language": lang_name,
            "job_description": "Sample Job",
            "resume_data": "{}",
        }),
        (templates.OUTREACH_MESSAGE_PROMPT, {
            "output_language": lang_name,
            "job_description": "Sample Job",
            "resume_data": "{}",
        }),
        (templates.GENERATE_TITLE_PROMPT, {
            "output_language": lang_name,
            "job_description": "Sample Job",
        }),
        (templates.SKILL_TARGET_PLAN_PROMPT, {
            "output_language": lang_name,
            "existing_skills": "[]",
            "job_keywords": "python",
            "job_description": "Sample Job",
            "original_resume": "{}",
        }),
        (templates.DIFF_IMPROVE_PROMPT, {
            "strategy_instruction": "strategy",
            "output_language": lang_name,
            "job_keywords": "python",
            "skill_targets": "python",
            "job_description": "Sample Job",
            "original_resume": "{}",
        }),
    ]

    for p, kwargs in prompt_list:
        assert "{output_language}" in p
        formatted = p.format(**kwargs)
        assert lang_name in formatted


    # Test enrichment prompts
    enrichment_prompts = [
        (enrichment.ANALYZE_RESUME_PROMPT, {
            "output_language": lang_name,
            "resume_json": "{}",
        }),
        (enrichment.ENHANCE_DESCRIPTION_PROMPT, {
            "output_language": lang_name,
            "item_type": "experience",
            "title": "Engineer",
            "subtitle": "Company",
            "current_description": "[]",
            "answers": "[]",
        }),
        (enrichment.REGENERATE_ITEM_PROMPT, {
            "output_language": lang_name,
            "item_type": "experience",
            "title": "Engineer",
            "subtitle": "Company",
            "current_description": "[]",
            "user_instruction": "more details",
        }),
        (enrichment.REGENERATE_SKILLS_PROMPT, {
            "output_language": lang_name,
            "current_skills": "[]",
            "user_instruction": "add python",
        }),
    ]
    for ep, kwargs in enrichment_prompts:
        assert "{output_language}" in ep
        formatted = ep.format(**kwargs)
        assert lang_name in formatted


    # Test resume wizard prompt
    assert "{output_language}" in resume_wizard.RESUME_WIZARD_TURN_PROMPT
    formatted_wizard = resume_wizard.RESUME_WIZARD_TURN_PROMPT.format(
        output_language=lang_name,
        current_section="intro",
        resume_json="{}",
        answer_text="John Doe",
    )
    assert lang_name in formatted_wizard

