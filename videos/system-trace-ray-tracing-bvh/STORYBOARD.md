---
format: 1080x1920
duration: 52s
message: "A BVH makes ray traversal practical by rejecting large regions before triangle tests"
arc: concept-explainer
audience: "players curious about real-time ray tracing"
mode: autonomous
music: "restrained minimal electronic pulse, analytical rather than ominous, no vocals"
captions: true
series: "SYSTEM TRACE"
episode: "06"
---

## Video direction

The visual metaphor is a traversal scanner. Amber is the active ray and current
test, cyan is a confirmed surviving branch and dim orange is rejected geometry.
Keep nested boxes visibly hierarchical and use only a small number of large
triangles so every decision reads instantly on a phone.

## Frame 1 - Millions of triangles

- scene: One ray faces an overwhelming field of triangles, then most geometry dims behind a single question mark.
- voiceover: "Ray tracing sounds impossible at game speed. One ray could meet millions of triangles, unless the renderer learns where not to look."
- duration: 8.853s
- poster: 5.8s
- transition_in: cut
- status: animated
- src: compositions/frames/01-millions.html
- type: hook
- persuasion: Scale shock
- beat: Tension + curiosity
- blueprint: kinetic-type-beats (Adapt)
- focal: ONE RAY versus MILLIONS OF TRIANGLES
- roles: ray and triangle field = foreground subjects - count ticker = supporting - traversal grid = background
- sfx: impact-bass-1, glitch-1

Adapt: replace an impossible all-triangle test with the question WHERE NOT TO LOOK.

Scene 1 (0.0-2.6s): ONE RAY enters from the lower left and freezes before a dense triangle field.

Scene 2 (2.6-5.6s): A count races upward while TEST EVERYTHING? fills the centre.

Scene 3 (5.6-8.5s): Most triangles dim and the headline swaps to WHERE NOT TO LOOK.

narrativeRole: Establishes the brute-force problem that acceleration structures solve.
keyMessage: Testing a ray against every triangle is too expensive.

## Frame 2 - Boxes inside boxes

- scene: A scene-sized box opens into two branches, then into smaller leaf boxes around triangle groups.
- voiceover: "Real-time systems organise geometry into a bounding volume hierarchy, or B-V-H: nested boxes around progressively smaller groups of shapes."
- duration: 10.624s
- poster: 6.4s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/02-nested-boxes.html
- type: product_intro
- persuasion: Progressive hierarchy
- beat: Orientation + clarity
- blueprint: spatial-pan-stations (Adapt)
- focal: the WORLD to BRANCH to LEAF hierarchy
- roles: bounding boxes = foreground subject - triangle clusters = supporting - hierarchy rails = midground - dark field = background
- sfx: click-soft, whoosh-short

Adapt: descend through three vertically stacked hierarchy levels, keeping the parent-child rails visible.

Scene 1 (0.0-2.8s): WORLD BOX draws around all geometry.

Scene 2 (2.8-6.0s): It splits into two BRANCH boxes, each containing different shapes.

Scene 3 (6.0-9.0s): One branch opens into small LEAF boxes and BVH labels the complete tree.

narrativeRole: Defines the nested spatial hierarchy used for traversal.
keyMessage: Geometry is grouped into boxes that become progressively more specific.

## Frame 3 - Miss one box

- scene: A ray misses a large branch box and the entire enclosed triangle count collapses to zero tests.
- voiceover: "A ray first tests a large box. If it misses, every triangle inside that branch is rejected at once."
- duration: 7.531s
- poster: 5.6s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-branch-miss.html
- type: feature_showcase
- persuasion: One decisive proof
- beat: Satisfaction + speed
- blueprint: fixed-anchor-cycle (Adapt)
- focal: the ray missing one box and cancelling an entire branch
- roles: ray/branch box = foreground mechanism - enclosed triangles = supporting - test counter = foreground proof - grid = background
- sfx: click, whoosh

Adapt: pin the ray origin and animate one geometric miss, then show its multiplied consequence.

Scene 1 (0.0-2.5s): RAY TEST 1 begins against a large amber branch box.

Scene 2 (2.5-5.3s): The ray passes outside its boundary. MISS flashes once.

Scene 3 (5.3-7.8s): Forty enclosed triangle markers dim together and TRIANGLE TESTS: 0 holds.

narrativeRole: Demonstrates the core pruning advantage of a hierarchy.
keyMessage: A box miss rejects every object in that branch.

## Frame 4 - Narrow the search

- scene: A ray traverses one surviving branch through world, branch and leaf boxes before testing three final triangles.
- voiceover: "The search narrows from world-sized regions to smaller boxes, then to the few triangles that might be hit. Empty space becomes cheap."
- duration: 9.216s
- poster: 6.4s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-narrow-search.html
- type: feature_showcase
- persuasion: Causal traversal
- beat: Progress + understanding
- blueprint: spatial-pan-stations (Adapt)
- focal: one highlighted traversal path narrowing to a triangle hit
- roles: active path = foreground subject - nested boxes = foreground mechanism - rejected siblings = supporting - traversal stack = background
- sfx: click-soft, notification

Adapt: pan down the active hierarchy path while rejected siblings remain dim but visible.

Scene 1 (0.0-2.8s): WORLD / HIT sends the ray into one cyan branch.

Scene 2 (2.8-5.9s): BRANCH / HIT opens one leaf while two siblings reject.

Scene 3 (5.9-8.8s): LEAF / HIT exposes three triangles, one intersection lights and EMPTY SPACE: CHEAP holds.

narrativeRole: Shows the narrowing search from coarse bounds to precise geometry.
keyMessage: Traversal spends detailed tests only where intersections remain possible.

## Frame 5 - The structure has a cost

- scene: STATIC and MOVING geometry compare cheap traversal against rebuild and update work on two cost meters.
- voiceover: "Building and updating that structure still costs time, especially when geometry moves. Engines balance rebuild quality, update cost and ray count."
- duration: 10.197s
- poster: 6.6s
- transition_in: crossfade
- status: animated
- src: compositions/frames/05-build-cost.html
- type: social_proof
- persuasion: Honest trade-off
- beat: Nuance + confidence
- blueprint: comparison-split (Adapt)
- focal: TRAVERSAL SAVED versus STRUCTURE UPDATED
- roles: build/update meters = foreground proof - static/moving panels = foreground comparison - box trees = supporting - analysis grid = background
- sfx: glitch-2, impact-bass-1

Adapt: stack static and moving cases, preserving the same hierarchy so only update cost changes.

Scene 1 (0.0-3.0s): STATIC geometry shows a stable tree and low update meter.

Scene 2 (3.0-6.4s): MOVING geometry shifts two leaves and raises REFIT / REBUILD work.

Scene 3 (6.4-9.1s): QUALITY / UPDATE COST / RAY COUNT align as a three-way balance.

narrativeRole: Prevents the acceleration structure from sounding free to maintain.
keyMessage: Faster traversal is balanced against build and update work.

## Frame 6 - Ask what can be ignored

- scene: A complete scene contracts into one large-box miss, one surviving path and one final triangle hit beside the closing rule.
- voiceover: "Real-time ray tracing does not brute-force the scene. It wins by asking a better first question: which parts can this ray ignore?"
- duration: 9.045s
- poster: 6.4s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-ignore-first.html
- type: branding
- persuasion: Distillation + callback
- beat: Resolve + memorability
- blueprint: titlecard-reveal (Adapt)
- focal: REJECT THE REGION / TEST THE FEW
- roles: final rule card = foreground subject - ray, hierarchy and hit = supporting - SYSTEM TRACE marker = background
- sfx: notification, chime

Adapt: compress the traversal into one clean visual sentence and hold the final principle.

Scene 1 (0.0-3.0s): One branch misses and dims with all enclosed geometry.

Scene 2 (3.0-6.4s): One surviving branch narrows to a leaf and a single triangle hit.

Scene 3 (6.4-8.8s): REJECT THE REGION / TEST THE FEW holds with SYSTEM TRACE // 06.

narrativeRole: Converts the traversal mechanism into one memorable rule.
keyMessage: Ray tracing gains speed by eliminating impossible regions before precise tests.
