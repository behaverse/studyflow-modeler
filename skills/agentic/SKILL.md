---
name: agentic
description: "Models as actors: a language model as a participant the study's steps ask along message flows, prompts kept as data, and the runner that plays a model's pool. Use when a study asks a model, or evaluates one."
license: MIT
compatibility: "Local runtime with uv; Ollama on this machine for ollama:// models, ANTHROPIC_API_KEY for claude:// ones."
metadata:
  schema: "agentic.moddle.yaml"
  runtimes:
    local: "uv run --script local.py"
---

A model is a pool of its own: a `studyflow:Actor` with `actorType: llm` and no process, named by its
`implementation` (`ollama://gemma4:12b-it-qat`, `claude://claude-haiku-4-5`). A step asks it with a message flow to
the pool and one back, and nothing else names a model. `local.py` plays such a pool in a local run: each message
sent to it is one request, and the reply goes back along the pool's flow (`../local/SKILL.md`, "Messages").

The request is the message's content, in its order. A `Prompt` wired into the asking step gives its text, an image
file in the run or a `data:image/` value goes as an image, other text as text, and anything else as JSON. The runner
adds no prompt of its own. A call that fails answers null, and the run records the error.

Each answer comes back with a `record`, which joins the step's record and is never a value a step reads
(`../local/SKILL.md`, "What comes back"). From Ollama: the model, its digest and quantization level (`/api/tags`),
its default sampling parameters (`/api/show`), Ollama's version (`/api/version`), and the options this runner sends
(`think: false`, `stream: false`). From Claude: the model asked for, the model the response names, and
`max_tokens`. From both, `sent`: the request's text as sent, up to 4,000 characters, and how many images went with
it. The lookups are best effort: one that fails is noted under `unrecorded`, and the answer stands.
`test_local.py` is its self-check.
