# TryAngleTree (TAT) Language Specification + Usage Manual

A structural language for deterministic graph transformation and system modeling.

## Conceptual Model

```md
                  BRANCHES                     (UI / Meaning)
                      ▲
                      │
client  ─────────── <T@T> ─────────── server   (Projection / Surface)
                      │
                      ▼
                    ROOTS                      (Data / Engine)
```

**Roots define structure.
Branches define meaning.
TAT binds them.**

---

## Quick Example (RPG)

The following example defines a simple interaction where a hero attacks a goblin:

```tat
heroNode = <{ id: "hero", type: "character", name: "Hero" }>
goblinNode = <{ id: "goblin", type: "enemy", name: "Goblin" }>
attackNode = <{ id: "attack", type: "action", name: "Attack" }>

attack := @action {
  guard:
    @query {
      node: to
      state: "hp"
    }
  pipeline:
    -> @graft.branch(from, "attacks", to)
    -> @graft.state(to, "hp", 0)
    -> @graft.meta(to, "status", defeated)
}

@seed:
  nodes: [heroNode, goblinNode, attackNode]
  edges: []
  state: {}
  meta: {}
  root: heroNode

battle := @seed
  -> @graft.state(goblinNode, "hp", 3)
  -> @apply(<heroNode.attack.goblinNode>)
  <> @project(format: "graph")
```

### What this demonstrates

- Nodes define structure
- Actions define behavior
- `@apply` executes behavior via traversal
- `@graft.*` mutates the graph
- `@project` produces output

**Core pattern: define → apply → mutate → project**

---

## Suggested Applications

TryAngleTree (TAT) is a general-purpose structural language for modeling and transforming relationships, state, and behavior.

TAT operates as a structural execution layer between data (roots) and presentation (branches), enabling systems to be defined, evaluated, and transformed in a unified graph model.

### Example domains

#### 🎓 Learning Systems

- Skill progression graphs
- Adaptive pathways
- Feedback engines

#### 🎵 Music Systems

- Harmonic relationships
- Voice-leading rules
- Composition engines

#### 🤖 AI & Decision Systems

- Rule evaluation
- Action selection
- Context reasoning

#### ⚙️ Workflow Systems

- Task pipelines
- Approval flows
- State machines

#### 🎮 Game Systems (Example Domain)

- Combat systems
- Ability trees
- Turn-based logic

---

**Note:** Examples in this specification use multiple domains (RPG, music, AI, learning) for illustration. TAT is not domain-specific.

---

# 1. Core Model

## 1.1 Node

```ts
Node {
  id: string
  value: any
  state: Record<string, any>
  meta: Record<string, any>
}
```

### Example (Learning)

```tat
studentNode = <{ id: "student", type: "learner" }>
skillNode = <{ id: "fractions", type: "skill" }>
```

---

## 1.2 Edge

```ts
Edge {
  subject: Node
  relation: string
  object: Node
  kind: "branch" | "progress"
}
```

### Example (Music)

```tat
-> @graft.branch(chordVNode, "resolvesTo", chordINode)
```

---

## 1.3 Identity Model

| Concept   | Example    |
| --------- | ---------- |
| Binding   | `heroNode` |
| Node ID   | `"hero"`   |
| Traversal | `hero`     |

---

# 2. Syntax System

## 2.1 Pipeline

```tat
-> operation(...)
```

### Example (AI)

```tat
-> @graft.state(agentNode, "confidence", 0.92)
```

---

## 2.2 Traversal

```tat
<from.action.to>
```

### Example

```tat
@apply(<agentNode.evaluate.inputNode>)
```

---

# 3. Operator Reference

---

# 3.1 @graft.state

```tat
-> @graft.state(node, key, value)
```

### Example (Learning)

```tat
-> @graft.state(studentNode, "mastery", 0.8)
```

---

# 3.2 @graft.branch

```tat
-> @graft.branch(subject, relation, object)
```

### Example (AI)

```tat
-> @graft.branch(agentNode, "selects", actionNode)
```

---

# 3.3 @prune.branch

```tat
-> @prune.branch(subject, relation, object)
```

---

# 3.4 @query

### Example (Music)

```tat
@query {
  subject: chordVNode
  relation: "resolvesTo"
  object: chordINode
}
```

### Example (AI)

```tat
@query {
  node: agentNode
  state: "confidence"
  equals: 1
}
```

---

# 3.5 @derive.state

```tat
@derive.state {
  node: node
  key: "value"
}
```

### Example (Learning)

```tat
count: @derive.state {
  node: studentNode
  key: "progress"
}
```

---

# 3.6 @loop

```tat
@loop {
  count: ...
  until: @query { ... }
  pipeline:
    -> ...
}
```

### Example (RPG)

```tat
@loop {
  count: 3
  pipeline:
    -> @apply(<heroNode.attack.goblinNode>)
}
```

---

# 3.7 @if

```tat
@if {
  condition: @query { ... }
  then:
    -> ...
  else:
    -> ...
}
```

### Example (AI)

```tat
@if {
  condition: @query {
    node: agentNode
    state: "confidence"
    equals: 1
  }
  then:
    -> @graft.meta(agentNode, "decision", approved)
}
```

---

# 3.8 @when

```tat
@when {
  event: @query { ... }
  pipeline:
    -> ...
}
```

### Example (Learning)

```tat
@when {
  event: @query {
    node: studentNode
    state: "mastery"
    equals: 1
  }
  pipeline:
    -> @graft.meta(skillNode, "status", unlocked)
}
```

---

# 3.9 @apply

```tat
-> @apply(<from.action.to>)
```

---

# 3.10 @action

```tat
action := @action {
  guard: ...
  pipeline:
    -> ...
}
```

---

# 3.11 @project

```tat
<> @project(format: "graph")
```

---

# 3.12 @graph / @effect

Defines graph-to-graph interactions and transformations between graph contexts.

```tat
@graph(source)
-> @effect(target)
```

---

# 4. Control Flow Patterns

## Loop (Music)

```tat
@loop {
  count: 4
  pipeline:
    -> @apply(<voiceNode.resolve.noteNode>)
}
```

---

## Conditional (AI)

```tat
@if {
  condition: @query { node: agentNode state: "risk" equals: high }
  then:
    -> @graft.meta(agentNode, "decision", reject)
}
```

---

## Reactive (Learning)

```tat
@when {
  event: @query { node: studentNode state: "score" equals: 100 }
  pipeline:
    -> @graft.meta(studentNode, "badge", awarded)
}
```

---

# 5. Formal Grammar

```ebnf
Program ::= Statement*

Statement ::= Binding | ActionBinding | Seed | Pipeline

Binding ::= Identifier "=" Value
ActionBinding ::= Identifier ":=" ActionExpr

ActionExpr ::= "@action" "{" Guard Pipeline "}"

Pipeline ::= ("->" Operation)+

Apply ::= "@apply" "(" Traversal ")"
Traversal ::= "<" Identifier "." Identifier "." Identifier ">"

Loop ::= "@loop" "{" ("count" ":" Expr)? ("until" ":" Expr)? "pipeline" ":" Pipeline "}"

If ::= "@if" "{" "condition" ":" Expr "then" ":" Pipeline ("else" ":" Pipeline)? "}"

When ::= "@when" "{" "event" ":" Expr "pipeline" ":" Pipeline "}"

Query ::= "@query" "{" QueryFields "}"

Derive ::= "@derive.state" "{" Node Key "}"
         | "@derive.meta" "{" Node Key "}"
```

---

# 6. Execution Semantics

```
seed → mutate → apply → control → triggers → project
```

- deterministic
- explicit
- graph-driven

---

# 7. Design Principles

1. Graph-first modeling
2. Deterministic execution
3. Explicit mutation
4. Separation of rendering
5. Composability

---

# 8. License

## 8.1 Overview

TryAngleTree (TAT) is released under the MIT License.

This license permits free use, modification, distribution, and private or commercial application of the language and its reference implementation.

The name "TryAngleTree" and the abbreviation "TAT" are the intellectual property of the original author and are protected as project branding.

---

## 8.2 MIT License

Copyright (c) 2026 Carl Biggers-Johanson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

---

## 8.3 Disclaimer

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## 8.4 Trademark and Branding

The names "TryAngleTree" and "TAT" are reserved project identifiers and may not be used to represent derivative or modified versions of the language without explicit permission from the author.

You are free to:
- use TAT in personal, educational, or commercial projects
- build applications powered by TAT
- extend or modify the language for your own use

You may not:
- publish modified versions of the language under the name "TryAngleTree" or "TAT"
- imply official affiliation or endorsement without permission

---

## 8.5 Attribution

Attribution is appreciated but not required.

Suggested attribution:

> "Powered by TryAngleTree (TAT)"