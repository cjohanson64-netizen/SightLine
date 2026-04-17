# SightLine

**SightLine** is an intelligent sight-singing exercise generator for music teachers and students.

It produces structurally sound, musically singable melodic lines on demand, grounded in harmonic grammar, phrase contour planning, and controlled melodic motion.

SightLine is designed to generate usable material quickly while still allowing teachers to export and refine exercises as needed.

---

## Purpose

SightLine helps teachers:

* Generate sight-singing exercises on demand
* Customize constraints such as range, cadence type, rhythm, and interval rules
* Export MusicXML for use in notation software
* Maintain classical harmonic integrity

It also supports students by providing structured melodic practice built on musically coherent material.

---

## Core Features

### Structured Phrase Planning

* Contour-driven melodic skeleton
* Planned climax placement
* Cadence-aware phrase endings

### Functional Harmony Spine

* Tonnetz-based neighbor selection
* Functional role filtering (T → PD → D → T)
* Enforced cadence-tail patterns:

  * Authentic: 2–5–1, 1–5–1, 4–5–1
  * Plagal: 1–4–1, 6–4–1
  * Half: 4–1–5, 5–1–5

### Rhythm-First Grid Planning

* Rhythm templates selected before pitch realization
* No dotted rhythms (by design)
* On-beat eighth-note pairs only
* User-defined rhythm distribution (EE, Q, H, W)

### Node–Edge Melody Model

* Pass 3: structural anchor selection (nodes)
* Pass 4: intentional motion between anchors (edges)
* Stepwise bias with controlled third usage
* Configurable limits on large leaps

### Constraint System

* Illegal scale degrees
* Illegal melodic intervals
* Illegal degree-to-degree transitions
* Tessitura enforcement
* Maximum leap control
* Dominant tendency resolution

### Export and Playback

* MusicXML export for notation editing
* Deterministic, seed-based generation
* Playback validation aligned with rendered notation

---

## Architecture Overview

SightLine uses a structured multi-pass generation pipeline:

### Pass 0 – Normalize and Validate

* Validate user inputs
* Apply defaults
* Normalize rhythm weights

### Pass 1 – Harmony Spine

* Generate half-measure harmonic structure
* Apply functional filtering
* Enforce cadence-tail patterns

### Pass 2 – Phrase Plan and Rhythm Grid

* Determine contour arc and climax
* Lock rhythmic structure early
* Select per-measure templates

### Pass 3 – Structural Skeleton Pitching

* Select anchor pitches aligned with contour and harmony
* Enforce tessitura and leap constraints

### Pass 4 – Edge Composition

* Compose motion between anchors
* Apply stepwise smoothing
* Enforce eighth-note motion rules

### Pass 5 – Constraint Cleanup

* Apply illegal degree and interval rules
* Enforce dominant tendency resolution
* Apply leap budgeting per phrase
* Final validation pass

### Pass 6 – Playback Projection

* Convert notation to playback timing
* Validate structural integrity

---

## Installation

```bash
npm install
npm run dev
```

Build the production bundle:

```bash
npm run build
```

---

## Usage

1. Select key, mode, range, cadence type, and phrase length
2. Adjust rhythm distribution and constraints as needed
3. Generate an exercise
4. Export MusicXML for further editing if desired

SightLine is designed so that:

* Most exercises are usable immediately
* Minor refinements can be made in notation software when needed

---

## Design Philosophy

SightLine does not attempt to replace the teacher.

It generates melodies that are:

* Structurally sound
* Singable
* Harmonically coherent

The goal is not perfection, but usability and editability.

---

## Future Directions

Potential enhancements include:

* Motivic development detection
* Adjustable stylistic profiles
* Expanded rhythmic vocabulary
* Student practice mode with feedback
* Multi-voice counterpoint support

---

## License

Copyright (c) 2026 Carl Biggers-Johanson

All rights reserved.

This software and associated documentation files may not be copied, modified, distributed, or used without explicit permission from the copyright holder.