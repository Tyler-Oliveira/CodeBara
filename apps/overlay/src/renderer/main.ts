type CodebaraEvent = import('@codebara/shared/dist/events').CodebaraEvent;
type CodebaraAnimation = import('@codebara/shared/dist/types').CodebaraAnimation;
type CodebaraWindow = Window & {
  codebara: {
    onEvent(callback: (event: CodebaraEvent) => void): void;
    setMouseInteractive(interactive: boolean): void;
    setDragging(dragging: boolean): void;
  };
};

const pet = document.getElementById('pet') as HTMLDivElement;
const sprite = document.getElementById('sprite') as HTMLDivElement;
const bubble = document.getElementById('bubble') as HTMLDivElement;

const petSize = 128;
const edgePadding = 16;
const topPadding = 28;
const bottomPadding = 42;
const walkSpeed = 165;
const minTargetDistance = petSize * 1.8;
const faceOffset = {
  right: { x: 104, y: 62 },
  left: { x: 24, y: 62 }
};
const dragLines = [
  'Why did you move me? I was eating over there.',
  'Excuse me, I had a whole workflow happening.',
  'Fine. I live here now, apparently.',
  'Dragged like a tab with unresolved trauma.',
  'Was that necessary, or just product management?',
  'I was supervising from a better angle.',
  'Great. Relocated by the hand of chaos.',
  'Put me down. I have code to judge.'
];

const animations: Record<CodebaraAnimation, { file: string; frames: number; speed: string }> = {
  idle: { file: 'charlie-sitting-idle.png', frames: 8, speed: '0.9s' },
  walk: { file: 'charlie-walk.png', frames: 8, speed: '0.62s' },
  sit: { file: 'charlie-sit-down.png', frames: 3, speed: '0.7s' },
  munch: { file: 'charlie-munch-grass.png', frames: 8, speed: '0.95s' },
  panic: { file: 'charlie-stand-up.png', frames: 4, speed: '0.35s' },
  celebrate: { file: 'charlie-lean-up.png', frames: 5, speed: '0.55s' },
  inspect: { file: 'charlie-lean-down.png', frames: 5, speed: '0.7s' }
};

let x = 120;
let y = 0;
let targetX = x;
let targetY = y;
let walking = false;
let lastFrameTime = 0;
let bubbleTimer: number | undefined;
let restTimer: number | undefined;
let roamTimer: number | undefined;
let speaking = false;
let walkingForObservation = false;
let pendingObservationMessage: string | undefined;
let dragging = false;
let pointerInsidePet = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

(window as unknown as CodebaraWindow).codebara.onEvent((event) => {
  switch (event.type) {
    case 'summon':
      speak('I have arrived to supervise the questionable decisions.');
      startRoaming();
      break;
    case 'say':
      speak(event.message);
      break;
    case 'mood':
      speak(`Mood set to ${event.mood}. This can only help so much.`);
      break;
    case 'editorChanged':
      setAnimation('inspect');
      speak(event.fileName ? `Inspecting ${event.fileName}. I have concerns.` : 'Watching the editor. Bold choice.');
      break;
    case 'diagnosticsChanged':
      handleDiagnostics(event.message);
      break;
    case 'terminalError':
      setAnimation('panic');
      speak(event.message || 'The terminal coughed. Elegant, in a tragic way.');
      break;
    case 'terminalSuccess':
    case 'celebrate':
      setAnimation('celebrate');
      speak(event.message || 'No errors. Suspicious, but I will allow it.');
      break;
    case 'panic':
      setAnimation('panic');
      speak(event.message || 'The red squiggles have formed a small committee.');
      break;
    case 'observation':
      if (event.target) {
        walkToObservation(event.target.x * window.innerWidth, event.target.y * window.innerHeight, event.message);
      } else {
        speak(event.message);
      }
      break;
    case 'animation':
      setAnimation(event.animation);
      if (event.message) {
        speak(event.message);
      }
      break;
    case 'hide':
      break;
    default:
      break;
  }
});

setAnimation('idle');
placePet(Math.max(24, Math.round(window.innerWidth * 0.12)), defaultY());
window.addEventListener('resize', () => {
  placePet(x, y);
  targetX = clamp(targetX, minX(), maxX());
  targetY = clamp(targetY, minY(), maxY());
});
window.requestAnimationFrame(animateWalk);
startRoaming();

function handleDiagnostics(message: string | undefined): void {
  if (message?.toLowerCase().includes('error') || message?.toLowerCase().includes('squiggles')) {
    setAnimation('panic');
  } else if (message?.toLowerCase().includes('peace')) {
    setAnimation('celebrate');
  } else {
    setAnimation('inspect');
  }

  if (message) {
    speak(message);
  }
}

function setAnimation(animation: CodebaraAnimation): void {
  const config = animations[animation];
  pet.dataset.animation = animation;
  sprite.style.backgroundImage = `url("../../assets/capybara/${config.file}")`;
  sprite.style.setProperty('--frames', String(config.frames));
  sprite.style.setProperty('--sheet-width', `${config.frames * 128}px`);
  sprite.style.setProperty('--sprite-shift', `${config.frames * -128}px`);
  sprite.style.setProperty('--speed', config.speed);
}

pet.addEventListener('mouseenter', () => {
  pointerInsidePet = true;
  (window as unknown as CodebaraWindow).codebara.setMouseInteractive(true);
});

pet.addEventListener('mouseleave', () => {
  pointerInsidePet = false;
  if (!dragging) {
    (window as unknown as CodebaraWindow).codebara.setMouseInteractive(false);
  }
});

pet.addEventListener('mousedown', (event) => {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  dragging = true;
  speaking = false;
  walking = false;
  walkingForObservation = false;
  pendingObservationMessage = undefined;
  dragOffsetX = event.clientX - x;
  dragOffsetY = event.clientY - y;
  window.clearTimeout(bubbleTimer);
  window.clearTimeout(roamTimer);
  window.clearTimeout(restTimer);
  bubble.classList.add('hidden');
  setAnimation('walk');
  (window as unknown as CodebaraWindow).codebara.setMouseInteractive(true);
  (window as unknown as CodebaraWindow).codebara.setDragging(true);
});

window.addEventListener('mousemove', (event) => {
  if (!dragging) {
    return;
  }

  placePet(event.clientX - dragOffsetX, event.clientY - dragOffsetY);
  targetX = x;
  targetY = y;
});

window.addEventListener('mouseup', () => {
  if (!dragging) {
    return;
  }

  dragging = false;
  (window as unknown as CodebaraWindow).codebara.setDragging(false);
  walking = false;
  walkingForObservation = false;
  targetX = x;
  targetY = y;
  speak(randomDragLine(), 'sit');

  if (!pointerInsidePet) {
    (window as unknown as CodebaraWindow).codebara.setMouseInteractive(false);
  }
});

function speak(message: string, animation: CodebaraAnimation = 'idle'): void {
  speaking = true;
  walking = false;
  walkingForObservation = false;
  pendingObservationMessage = undefined;
  window.clearTimeout(roamTimer);
  window.clearTimeout(restTimer);
  setAnimation(animation);

  bubble.textContent = message;
  bubble.classList.remove('hidden');
  window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => {
    bubble.classList.add('hidden');
    speaking = false;
    scheduleNextWalk(1300 + Math.random() * 2200);
  }, speechDuration(message));
}

function startRoaming(): void {
  window.clearTimeout(roamTimer);
  window.clearTimeout(restTimer);

  walking = false;
  if (!speaking && !dragging) {
    scheduleNextWalk(1400);
  }
}

function scheduleNextWalk(delay = 5200 + Math.random() * 6800): void {
  if (speaking || dragging) {
    return;
  }
  window.clearTimeout(roamTimer);
  roamTimer = window.setTimeout(() => {
    walkRandomly();
  }, delay);
}

function restBeforeNextWalk(): void {
  walkingForObservation = false;
  walking = false;
  setAnimation(Math.random() > 0.72 ? 'munch' : 'idle');
  window.clearTimeout(restTimer);
  restTimer = window.setTimeout(() => {
    scheduleNextWalk();
  }, 1800 + Math.random() * 2600);
}

function walkRandomly(): void {
  if (speaking || dragging) {
    return;
  }

  const nextTarget = randomTarget();
  const distance = Math.hypot(nextTarget.x - x, nextTarget.y - y);

  if (distance < 2) {
    scheduleNextWalk(120);
    return;
  }

  lookAtPoint(nextTarget.x, nextTarget.y);
  targetX = nextTarget.x;
  targetY = nextTarget.y;
  walking = true;
  walkingForObservation = false;
  setAnimation('walk');
  window.clearTimeout(restTimer);
}

function walkToObservation(pointX: number, pointY: number, message: string): void {
  if (speaking || dragging) {
    return;
  }

  const nextTarget = observationTarget(pointX, pointY);
  targetX = nextTarget.x;
  targetY = nextTarget.y;
  pendingObservationMessage = message;
  walking = true;
  walkingForObservation = true;
  setAnimation('walk');
  window.clearTimeout(roamTimer);
  window.clearTimeout(restTimer);
}

function animateWalk(timestamp: number): void {
  const elapsed = lastFrameTime ? (timestamp - lastFrameTime) / 1000 : 0;
  lastFrameTime = timestamp;

  if (walking && !speaking && !dragging) {
    const deltaX = targetX - x;
    const deltaY = targetY - y;
    const distance = Math.hypot(deltaX, deltaY);
    const step = walkSpeed * elapsed;

    if (distance <= Math.max(1, step)) {
      placePet(targetX, targetY);
      if (walkingForObservation) {
        finishObservationWalk();
      } else {
        restBeforeNextWalk();
      }
    } else {
      placePet(x + (deltaX / distance) * step, y + (deltaY / distance) * step);
    }
  }

  window.requestAnimationFrame(animateWalk);
}

function lookAtPoint(pointX: number, _pointY: number): void {
  const face = facePosition();
  pet.classList.toggle('facing-left', pointX < face.x);
}

function finishObservationWalk(): void {
  const message = pendingObservationMessage;
  walking = false;
  walkingForObservation = false;
  pendingObservationMessage = undefined;
  setAnimation('inspect');

  if (message) {
    speak(message);
  } else {
    scheduleNextWalk(1200);
  }
}

function observationTarget(pointX: number, pointY: number): { x: number; y: number } {
  const targetIsRight = pointX > window.innerWidth / 2;
  const offset = targetIsRight ? faceOffset.right : faceOffset.left;
  const targetPetX = pointX - offset.x;
  const targetPetY = pointY - offset.y;
  pet.classList.toggle('facing-left', !targetIsRight);

  return {
    x: clamp(targetPetX, minX(), maxX()),
    y: clamp(targetPetY, minY(), maxY())
  };
}

function facePosition(): { x: number; y: number } {
  const offset = pet.classList.contains('facing-left') ? faceOffset.left : faceOffset.right;
  return { x: x + offset.x, y: y + offset.y };
}

function speechDuration(message: string): number {
  return clamp(3200 + message.length * 70, 4200, 7800);
}

function randomDragLine(): string {
  return dragLines[Math.floor(Math.random() * dragLines.length)];
}

function randomTarget(): { x: number; y: number } {
  let nextX = x;
  let nextY = y;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    nextX = randomBetween(minX(), maxX());
    nextY = randomBetween(minY(), maxY());

    if (Math.hypot(nextX - x, nextY - y) > minTargetDistance) {
      break;
    }
  }

  return { x: nextX, y: nextY };
}

function placePet(nextX: number, nextY: number): void {
  x = clamp(nextX, minX(), maxX());
  y = clamp(nextY, minY(), maxY());
  pet.style.left = `${x}px`;
  pet.style.top = `${y}px`;
}

function defaultY(): number {
  return maxY();
}

function minX(): number {
  return edgePadding;
}

function maxX(): number {
  return Math.max(edgePadding, window.innerWidth - petSize - edgePadding);
}

function minY(): number {
  return topPadding;
}

function maxY(): number {
  return Math.max(topPadding, window.innerHeight - petSize - bottomPadding);
}

function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * Math.max(0, max - min));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
