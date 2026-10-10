# Sample card photos

`card-NN.jpg` are synthetic phone photos of hand-drawn index cards (1280 px long side, JPEG 85), rendered by `backend/tools/make_samples.py` with fixed seeds. Run `python -m tools.make_samples` from `backend/` to rebuild them. Each photo has a `card-NN.truth.json` (`{"grid": rows x cols}`, codes 0 empty, 1 solid, 2 pass-through, 3 hazard) with the stage it should scan to.

They cover a dark table (wood, slate, felt) or a mid-grey one, tilt and rotation up to about 18 degrees, one card photographed sideways in a portrait frame, warm and cool light, shadows, glare, dim light with noise, motion blur, a bowed card, ink running off the card edge and into a corner, a nearly empty card and a crowded one.

Used by the vision tests (accuracy against the truth grids, timing), the stage tests (full pipeline under 1.5 s), the "Play a sample stage" button and the attract-mode gallery.

Real photos can be added next to them: blank (unruled) white card, dark table, whole card in frame. A truth file is optional: the vision accuracy tests skip photos without one.
