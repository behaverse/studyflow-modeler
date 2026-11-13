---
name: agentic
description: "Models as actors: a language model as an actor the study's steps ask along message flows, prompts kept as data, and the runner that plays a model's pool. Use when a study asks a model, or evaluates one."
license: MIT
compatibility: "Local runtime with uv; Ollama on this machine for ollama:// models, ANTHROPIC_API_KEY for claude:// ones."
metadata:
  schemes: "ollama, claude"  # the <scheme>:// references its runners execute
  schema: "agentic.moddle.yaml"
  runtimes:
    local: "uv run --script local.py"
---

A model is a pool of its own: a `studyflow:Actor` with no process, named by its `implementation`
(`ollama://gemma4:12b-it-qat`, `claude://claude-haiku-4-5`). A step asks it with a message flow to the pool and one
back, and nothing else names a model.

```yaml
participants:
  Pool_Model:
    name: Model (gemma4)
    extensions:
      studyflow:Actor:
        actorType: llm
        implementation: ollama://gemma4:12b-it-qat
        memory: conversation
messageFlows:
  Msg_Question:
    name: a question
    source: $Pool_Session
    target: $Pool_Model

  Msg_Answer:
    name: the answer
    source: $Pool_Model
    target: $Pool_Session
```

The flows here join the two pools, so every step of the session with something to send asks along them. A prompt
is a data object wired into the step that asks:

```yaml
Animal_Prompt:
  type: DataObjectReference
  name: First question
  extensions:
    agentic:Prompt:
      template: Name one animal. Answer with one word.
```

[`model_conversation`](examples/model_conversation.studyflow.yaml) is the whole study: two questions, the second of
which only a model that remembers the first can answer.

The scheme is what makes the pool this runner's, so the same pool played by another runner (`simulate://random`) is
a one-line change.

## The request

`local.py` plays a model's pool in a local run. Each message sent to the pool is one request, and the reply goes back
along the pool's flow ([the contract](../../packages/runtime-local/CONTRACT.md), "Messages"). The request is the
message's content, in its order.

| Content | Goes as |
| --- | --- |
| A `Prompt` wired into the asking step | Its text. |
| An image file in the run, or a `data:image/` value | An image. |
| Any other value | `<name>: <value>`, the value as text or, when it is not text, as JSON (`Stimulus: {"Value": "3"}`). |

The name is that of the element the content's key is (a property named `instruction`), else the key itself (a field
of a Behaverse trial). The runner adds no prompt of its own.

## Memory

The pool's `memory` says what the model is sent of the earlier messages.

| `memory` | The model is sent |
| --- | --- |
| `none`, the default | Each message on its own. |
| `conversation` | The conversation, turn by turn, before the new message. |
| `window` | The conversation cut to its instructions and its last `memoryWindow` exchanges (20 unless the actor says). |

- The runner keeps each conversation the walk names: one per instance of the pool asking, for the run. A model
  answering one subject therefore sees that subject's earlier trials, as sent, and its own answers to them.
- A runner started again mid-run has lost its conversations, and fails the message rather than ask without them.
- Under `window`, the instructions are the exchanges a prompt delivered once rode with, and what the model is sent
  stays the same size however long the session. The runner still keeps the whole conversation, and the record says
  `memory: window`, the `window`, and in `sent` how many exchanges it `remembered`.

Ollama keeps only the last `num_ctx` tokens of what it is sent, and drops the rest without saying so. The runner
therefore sends `num_ctx` sized to the conversation:

- at least 8,192 tokens, in powers of two, estimated generously from the characters sent;
- never shrinking for a model within a run, since a new size reloads the model;
- never past the model's own context length (`/api/show`), where the runner fails the message rather than let an
  earlier turn be dropped.

A conversation that keeps every trial of a long session can need a window of 10^5 tokens, and the memory to hold it.

## Decision models

An `ollama://` model that `/api/show` lists as a `decision` model (d1) writes no text: it returns a probability for
each answer it is offered.

- The runner asks it one choice question at `/v1/systemone`: the message's text as the question's instructions, the
  answers the message lists under `ResponseOptions` as its criteria, and the message's images. A message that lists
  no answers fails, since there is nothing to choose among.
- The model keeps no state between requests. In a conversation it receives what its pool remembers of the
  conversation (all of it, or its window) as its `state` with every message.
- Ollama serves the model with a window of its own (its `num_ctx`, else its context length) that a request cannot
  raise. A state past that window loses its oldest exchanges first, never the instructions or the message itself.
  The record says how many exchanges it `kept` and, when it dropped one, `truncated: true`. A message that does not
  fit with its instructions alone fails.
- The runner draws the answer from the probabilities with a seed keyed by the study, the participant (who asks) and
  the trial (how many messages that participant had sent the pool before), whatever the pool remembers. A re-run
  therefore draws the same answers whatever ids a task gives its messages.
- The record keeps the `probabilities`, the model's own most probable `choice` and `confidence`, and the `draw` (its
  key and the uniform `u`).

## Failures

- A call that fails answers nothing: the run records the error on the pool, and the step that asked fails with it.
  An error boundary event on that step, or on the sub-process around it, catches the failure (`error: true`), and
  with none the run fails.
- A model that has not answered in time is left by a timer boundary event (`timer: PT2M`).

`model_conversation` draws both on the sub-process that holds its two questions.

## The record

Each answer comes back with a `record`, which joins the step's record and is never a value a step reads
([the contract](../../packages/runtime-local/CONTRACT.md), "What comes back").

| From | The record holds |
| --- | --- |
| Ollama | The model, its digest and quantization level (`/api/tags`). |
| | Its default sampling parameters and context length (`/api/show`). |
| | Ollama's version (`/api/version`). |
| | The options this runner sends: `think: false`, `stream: false`, and `num_ctx`. |
| | The tokens the request was estimated to need (`contextEstimate`) and those Ollama evaluated for it (`promptTokens`). |
| | Which `kind` the model is, `chat` or `decision`. |
| Claude | The model asked for, the model the response names, and `max_tokens`. |
| Both | `sent`: the request's text as sent, up to 4,000 characters, how many images went with it, and in a conversation its `turn`. |

The lookups are best effort: one that fails is noted under `unrecorded`, and the answer stands.

`test_local.py` is the runner's self-check.
