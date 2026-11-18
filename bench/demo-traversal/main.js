// The traversal course: the character tool's actions (ledges, ropes, ladder, push and pull, crouch and slide) on the
// library bot, in a hall lit by the lighting tool, with the cable winch, the interaction props and the cistern water.
// Its clips are local files (private-assets/character/mixamo): without them the page says so and stops.
const CLIP_PROBE = '/character/mixamo/ledge/Braced Hang.fbx';
const hasClips = import.meta.env.DEV && await fetch(CLIP_PROBE, {method: 'HEAD'})
 .then(response => response.ok && !response.headers.get('content-type')?.includes('text/html'))
 .catch(() => false);

if (hasClips) {
 const [{startTraversalBench}, {loadTraversalBot}] = await Promise.all([import('./bench.js'), import('./traversal-bot.js')]);
 window.traversalDemo = await startTraversalBench({loadAvatar: loadTraversalBot, label: 'Mixamo bot'});
} else {
 document.querySelector('#status').textContent = 'This demo needs the local Mixamo clips in private-assets/character/mixamo.';
}
