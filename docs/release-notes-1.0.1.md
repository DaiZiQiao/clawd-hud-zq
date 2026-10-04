# mod-hud 1.0.1

Bug fixes.

## Agents
- An agent that is waiting, idle between turns or not yet started stays running; it was drawn as failed within five seconds.
- A colour code or other control character in an agent's task or answer no longer blanks the whole pane on the terminal; such text is shown cleaned.

## HUD
- Emoji take the cells the terminal draws them in (✅, ⚡, ❤️, flags, families, skin tones), so rows holding them no longer overflow or truncate early.

## Mascots
- The smooth scene keeps an agent's accessory, its parent and a debugger's visit to the maker's desk after agents finished a while ago leave its inputs.
- Fliers stay under the sky when they move a row nearer, and loop only where the circle fits.
- A spring in place is a row high, not four.
- A blocked hop goes on a hop's reach at a time at its own depth, and always comes down.
- A flier keeps clear of a hop's whole arc; nobody walks in beside a low flier held back as it rises.
- In `rare` collisions, a wanderer walking away from another walks on instead of stopping with it.

## Docs
- The README gives the motto's real default and says a thrown mascot knocks others over in `rare` and `normal`.
