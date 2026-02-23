Love it. Let’s give **SightLine** a README that matches the quality of the engine behind it.

Here’s a clean, professional, teacher-facing but technically solid README you can drop straight into the repo.

---

# SightLine

**SightLine** is an intelligent sight-singing exercise generator designed for music teachers and students.

It produces structurally sound, musically singable melodic lines on demand — grounded in harmonic grammar, phrase contour planning, and controlled melodic motion.

SightLine is built to generate usable material quickly, while still allowing teachers to export and refine exercises when desired.

---

## 🎯 Purpose

SightLine helps teachers:

* Generate sight-singing exercises on the fly
* Customize constraints (range, cadence type, rhythm, illegal intervals, etc.)
* Export MusicXML for editing in notation software
* Maintain classical harmonic integrity

It also supports students who want structured melodic practice with musically sensible lines.

---

## ✨ Core Features

### Structured Phrase Planning

* Contour-driven melodic skeleton
* Planned climax placement
* Cadence-aware phrase endings

### Functional Harmony Spine

* Tonnetz-based neighbor selection
* Functional role filtering (T → PD → D → T)
* 3-chord cadence-tail enforcement:

  * Authentic: 2–5–1, 1–5–1, 4–5–1
  * Plagal: 1–4–1, 6–4–1
  * Half: 4–1–5, 5–1–5

### Rhythm-First Grid Planning

* Rhythm templates selected before pitch realization
* No dotted rhythms (by design)
* On-beat EE pairs only
* User rhythm distribution support (EE, Q, H, W)

### Node–Edge Melody Model

* Pass 3: Structural anchor selection (nodes)
* Pass 4: Intentional edge composition between anchors
* Stepwise bias with controlled third usage
* Limited large leaps per phrase (configurable)

### Constraint System

* Illegal scale degrees
* Illegal melodic intervals
* Illegal degree-to-degree transitions
* Tessitura enforcement
* Max leap control
* Dominant tendency resolution

### Export + Playback

* MusicXML export for notation editing
* Deterministic seed-based generation
* Playback validation to match rendered notation

---

## 🧠 Architecture Overview

SightLine uses a structured multi-pass generation pipeline:

### Pass 0 – Normalize & Validate

* Validate user inputs
* Set defaults
* Normalize rhythm weights

### Pass 1 – Harmony Spine

* Generate half-measure harmony slots
* Apply functional filtering
* Enforce cadence-tail patterns

### Pass 2 – Phrase Plan + Rhythm Grid

* Determine contour arc and climax
* Lock rhythmic structure early
* Select per-measure templates

### Pass 3 – Structural Skeleton Pitching

* Choose anchor pitches aligned with contour and harmony
* Enforce tessitura and leap constraints

### Pass 4 – Edge Composition

* Compose intentional motion between anchors
* Stepwise smoothing
* EE melodic laws

### Pass 5 – Constraint Cleanup

* Apply illegal degree/interval rules
* Enforce dominant tendency
* Leap budgeting per phrase
* Final authority sweep

### Pass 6 – Playback Projection

* Convert notation to playback timing
* Assert structural integrity

---

## ⚙️ Installation

```bash
npm install
npm run dev
```

Build production bundle:

```bash
npm run build
```

---

## 🛠 Usage

1. Select key, mode, range, cadence type, and phrase length.
2. Adjust rhythm distribution and constraints if desired.
3. Generate exercise.
4. Export MusicXML for notation editing if needed.

SightLine is designed so that:

* Most exercises are usable immediately.
* Minor tweaks can be made in notation software if desired.

---

## 🎼 Design Philosophy

SightLine does not attempt to replace the teacher.

It aims to generate:

* Structurally sound
* Singable
* Harmonically coherent

melodies that serve as strong starting points.

Perfection is not the goal.
Usability and editability are.

---

## 🔮 Future Directions

Potential enhancements:

* Motivic development detection
* Adjustable stylistic profiles
* Expanded rhythmic vocabulary
* Student practice mode with feedback
* Multi-voice counterpoint mode

---

## 📜 License

Copyright (c) 2026 Carl Biggers-Johanson

All rights reserved.

This software and associated documentation files (the "Software") may not be copied, modified, distributed, or used without explicit permission from the copyright holder.

---

If you’d like, I can also:

* Write a short marketing version for a website landing page
* Draft a more technical README for developers
* Or refine this for a public GitHub release tone

SightLine deserves to launch clean.
