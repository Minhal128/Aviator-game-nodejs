// app.js
import { playSound, sndButton, sndBgm, sndCashout, sndBrake, sndPassby, sndHonk1, sndHonk2, sndGo, sndCrash } from './audio.js';
import { carImageAssets, idleFrames, jumpFrames, spriteImages } from './sprites.js';
import { initPRNG, getRNG, calculateMultiplierForIndex, GAME_MODES, setRtp } from './math.js';

// --- CORE DOM ELEMENTS ---
const roadContainer = document.getElementById('roadContainer');
const playerRig = document.getElementById('playerRig');
const badgeText = document.getElementById('badgeText');
const viewportArea = document.getElementById('viewportArea');
const dashboardControls = document.getElementById('dashboardControls');
const activeGameControls = document.getElementById('activeGameControls');
const cashoutActionButton = document.getElementById('cashoutActionButton');
const goActionButton = document.getElementById('goActionButton');
const betDisplayVal = document.getElementById('betDisplayVal');
const winToastNotification = document.getElementById('winToastNotification');
const toastMultiplierText = document.getElementById('toastMultiplierText');
const sidebarMenu = document.getElementById('sidebarMenu');
const sidebarMask = document.getElementById('sidebarMask');
const walletBalanceText = document.getElementById('walletBalanceText');
const playActionButton = document.getElementById('playActionButton');
const difficultyDropdown = document.getElementById('difficultyDropdown');
const spriteCanvas = document.getElementById('characterSprite');
const spriteCtx = spriteCanvas.getContext('2d');
const crHudBal = document.getElementById('crHudBal');
const crHudWin = document.getElementById('crHudWin');
const crHudBet = document.getElementById('crHudBet');
const crHudBetBtn = document.getElementById('crHudBetBtn');

// --- CONSTANTS & MAP STATE ---
const LANE_WIDTH = 110; 
const CAR_STOP_GAP = 24; 
const LOOP_BOUND = 300; 

let currentLaneIndex = 0; 
let absoluteLaneIndex = 0; 
let roadShiftX = 0;       
let isJumping = false;
let isGameOver = false;
let isVisualCrashHappening = false;
let isGameSessionActive = false; 
let murderousCarRef = null; 
let lastHonkTime = 0;

let activeCars = []; 
let activeBarriers = [];
let animationFrameId = null;

// --- ECONOMY & SEED STATE ---
let currentBetAmount = 10;
// the real balance is injected by Pages::gameStatic(); standalone opens stay on demo coins
const wallet = window.TL_WALLET || null;
const CURRENCY = (wallet && wallet.currency) ? wallet.currency : '₹';
// draw the lane multipliers at the same rtp the server settles at
if (wallet && wallet.winPct != null) setRtp(Number(wallet.winPct) / 100);
let currentWalletBalance = wallet ? wallet.balance : 100.00;
// live wallet uses site settings; standalone demo keeps the old 1–50 range
const MIN_BET = wallet && wallet.minBet != null ? Number(wallet.minBet) : 1;
const MAX_BET = wallet && wallet.maxBet != null ? Number(wallet.maxBet) : 50;

function maxAffordableBet() {
    return Math.max(MIN_BET, Math.min(MAX_BET, Math.floor(currentWalletBalance)));
}

function potentialWinInr() {
    if (!isGameSessionActive || isGameOver) return 0;
    const mult = parseFloat(getMultiplierVal(absoluteLaneIndex)) || 1;
    return Math.round(currentBetAmount * mult * 100) / 100;
}

function paintHud() {
    if (crHudBal) crHudBal.textContent = `${CURRENCY}${Number(currentWalletBalance).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    if (crHudWin) {
        const w = potentialWinInr();
        crHudWin.textContent = w > 0
            ? `${CURRENCY}${w.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
            : '0';
    }
    if (crHudBet) crHudBet.textContent = `${CURRENCY}${Number(currentBetAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    if (crHudBetBtn) crHudBetBtn.disabled = !!isGameSessionActive;
}

// --- HELPERS ---
function showBalance() {
    walletBalanceText.innerText = `${CURRENCY}${currentWalletBalance.toFixed(2)}`;
    if (wallet) wallet.balance = currentWalletBalance;
    if (typeof window.TL_setWallet === 'function') window.TL_setWallet(currentWalletBalance);
    paintHud();
}

function clampBet(raw) {
    let val = Number(raw);
    const cap = maxAffordableBet();
    if (!Number.isFinite(val) || val < MIN_BET) val = MIN_BET;
    else if (val > cap) val = cap;
    return Math.round(val * 100) / 100;
}

function applyBet(amount) {
    currentBetAmount = clampBet(amount);
    betDisplayVal.value = currentBetAmount;
    paintHud();
}

let serverSeed = "SRV_" + Math.random().toString(36).substring(2, 15);
let clientSeed = "CLI_" + Date.now();
let gameNonce = 0;

const safeLaneMap = {};
const laneDirectionMap = {};
const laneBaseSpeedMap = {};

let currentFrameIndex = 0;
let lastFrameTime = 0;
const animationFps = 24;
const frameDuration = 1000 / animationFps;

let currentCharacterState = 'idle';
let activeCharacterImg = spriteImages.idle;
let activeFramesSource = idleFrames;

/**
 * The server owns the money and the crash lane (RoadGame.php). Without
 * TL_WALLET the game is a standalone demo and keeps its old local behaviour.
 */
async function serverCall(action, body) {
    if (!wallet) return null;
    const res = await fetch(`/game/road/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': wallet.token, 'Accept': 'application/json' },
        body: JSON.stringify(body || {})
    });
    const json = await res.json();
    if (json.data && typeof json.data.balance === 'number') {
        currentWalletBalance = json.data.balance;
        if (wallet) wallet.balance = currentWalletBalance;
        showBalance();
    }
    return json;
}

function flashPlayButton(text) {
    const old = playActionButton.innerText;
    playActionButton.innerText = text;
    setTimeout(() => { playActionButton.innerText = old; }, 1200);
}

function getMultiplierVal(absoluteLaneIdx) {
    return calculateMultiplierForIndex(absoluteLaneIdx, difficultyDropdown.value);
}

// demo mode only: on the real wallet the crash lane comes from /game/road/step
function checkIsCrashLane(domLaneIdx, targetAbsIdx) {
    if (safeLaneMap[domLaneIdx] !== undefined) return !safeLaneMap[domLaneIdx];
    
    let modeKey = difficultyDropdown.value || 'medium';
    let mode = GAME_MODES[modeKey] || GAME_MODES.medium;
    let survivalChance = Math.max(0.05, mode.baseSurvival - (targetAbsIdx * mode.decay));
    let isTrap = getRNG() > survivalChance; 
    
    safeLaneMap[domLaneIdx] = !isTrap; 
    return isTrap;
}

// --- GLOBAL EXPORTS TO WINDOW FOR HTML ONCLICKS (Optional, if required by your HTML) ---
window.toggleSidebarMenu = function(openState) {
    playSound(sndButton);
    if (openState) {
        sidebarMenu.classList.add('open');
        sidebarMask.classList.add('active');
    } else {
        sidebarMenu.classList.remove('open');
        sidebarMask.classList.remove('active');
    }
};

window.refillWalletBalance = function() {
    playSound(sndButton);
    if (wallet) {
        flashPlayButton('Deposit on site');   // minting coins into a real wallet is not a thing
        return;
    }
    currentWalletBalance += 100.00;
    showBalance();
};

window.setMinBet = function() {
    playSound(sndButton);
    applyBet(MIN_BET);
};

window.setMaxBet = function() {
    playSound(sndButton);
    applyBet(maxAffordableBet());
};

window.handleCustomBetInput = function() {
    applyBet(betDisplayVal.value);
};

window.setFixedBet = function(amount) {
    playSound(sndButton);
    if (amount > currentWalletBalance) {
        flashPlayButton('Insufficient Funds');
        applyBet(maxAffordableBet());
        return;
    }
    applyBet(amount);
};

window.editHudBet = function() {
    if (isGameSessionActive) return;
    playSound(sndButton);
    const raw = window.prompt(
        `Bet (${CURRENCY}) — min ${MIN_BET}, max ${maxAffordableBet()}`,
        String(currentBetAmount),
    );
    if (raw === null) return;
    applyBet(raw);
};

window.handleDifficultyChange = function() {
    playSound(sndButton);
    if (!isGameSessionActive) {
        initPRNG(serverSeed, clientSeed, gameNonce); 
        resetGameEnvironment();
    }
};

window.triggerBetMatchStart = async function() {
    if (isGameSessionActive) return;
    playSound(sndButton);

    if (sndBgm.volume > 0 && sndBgm.paused) sndBgm.play().catch(e => {});
    
    if (currentWalletBalance < currentBetAmount) {
        flashPlayButton("Insufficient Funds");
        return;
    }

    if (wallet) {
        const res = await serverCall('bet', { bet: currentBetAmount, mode: difficultyDropdown.value });
        if (!res || !res.isSuccess) {
            flashPlayButton(res && res.message ? res.message : 'Bet failed');
            return;
        }
    } else {
        currentWalletBalance -= currentBetAmount;
        showBalance();
    }
    
    gameNonce++;
    initPRNG(serverSeed, clientSeed, gameNonce);

    isGameSessionActive = true;
    dashboardControls.style.display = 'none';
    activeGameControls.style.display = 'flex';
    
    cashoutActionButton.disabled = false;
    goActionButton.disabled = false;
    cashoutActionButton.style.opacity = "1";
    goActionButton.style.opacity = "1";
    cashoutActionButton.style.cursor = "pointer";
    goActionButton.style.cursor = "pointer";

    resetGameEnvironment();
    paintHud();
};

window.cashoutGame = async function() {
    if (!isGameSessionActive || isGameOver || isVisualCrashHappening || isJumping) return;
    isGameOver = true; 
    playSound(sndCashout);

    cashoutActionButton.disabled = true;
    goActionButton.disabled = true;
    cashoutActionButton.style.opacity = "0.5";
    goActionButton.style.opacity = "0.5";
    cashoutActionButton.style.cursor = "not-allowed";
    goActionButton.style.cursor = "not-allowed";

    let multStr = getMultiplierVal(absoluteLaneIndex);

    if (wallet) {
        const res = await serverCall('cashout', {});
        if (res && res.isSuccess) multStr = `${res.data.multiplier.toFixed(2)}x`;
    } else {
        currentWalletBalance += currentBetAmount * parseFloat(multStr);
        showBalance();
    }

    toastMultiplierText.innerText = multStr;
    winToastNotification.classList.add('show');
    setTimeout(() => { winToastNotification.classList.remove('show'); }, 3000);
    
    setTimeout(() => { resetGameToDashboard(); }, 1200);
};

window.performJump = async function() {
    if (!isGameSessionActive || isGameOver || isVisualCrashHappening || isJumping) return;
    isJumping = true;
    playSound(sndGo);

    currentCharacterState = 'jump';
    activeCharacterImg = spriteImages.jump;
    activeFramesSource = jumpFrames;
    currentFrameIndex = 0;

    const newDomLaneIndex = roadContainer.children.length; 
    const newAbsoluteLaneIndex = absoluteLaneIndex + (newDomLaneIndex - currentLaneIndex);
    
    const newLane = document.createElement('div');
    newLane.classList.add('lane');
    roadContainer.appendChild(newLane);
    generateLaneTraffic(newLane, newDomLaneIndex, newAbsoluteLaneIndex);

    currentLaneIndex++;
    absoluteLaneIndex++;

    // fire the step now, read it when the hop lands: the round trip hides behind the animation
    const stepPromise = wallet ? serverCall('step', {}) : null;
    const targetBallLeft = (currentLaneIndex * LANE_WIDTH) - 9;
    playerRig.style.left = `${targetBallLeft}px`;

    if (currentLaneIndex > 1) {
        roadShiftX -= LANE_WIDTH;
        roadContainer.style.transform = `translate3d(${roadShiftX}px, 0, 0)`;
    }

    playerRig.classList.add('jumping');
    setTimeout(() => { playerRig.classList.remove('jumping'); }, 150);

    setTimeout(async () => {
        if (isGameOver) return;

        let isTrapLane;
        if (stepPromise) {
            const res = await stepPromise;
            if (!res || !res.isSuccess) { isJumping = false; return; }
            isTrapLane = res.data.crashed;
            safeLaneMap[currentLaneIndex] = !isTrapLane;
        } else {
            isTrapLane = checkIsCrashLane(currentLaneIndex, absoluteLaneIndex);
        }

        const gridElements = roadContainer.children;
        badgeText.innerText = getMultiplierVal(absoluteLaneIndex);
        paintHud();

        if (isTrapLane) {
            cashoutActionButton.disabled = true;
            goActionButton.disabled = true;
            cashoutActionButton.style.opacity = "0.5";
            goActionButton.style.opacity = "0.5";
            
            spawnInstantCrashCar(gridElements[currentLaneIndex], currentLaneIndex);
        } else {
            placeSafetyRoadblocks(gridElements[currentLaneIndex], currentLaneIndex);
        }

        isJumping = false;

        if (currentLaneIndex > 6 && !isGameOver && !isVisualCrashHappening) {
            activeCars = activeCars.filter(car => {
                if (car.laneIndex === 0) { car.element.remove(); return false; }
                return true;
            });
            activeBarriers = activeBarriers.filter(bar => {
                if (bar.laneIndex === 0) { bar.element.remove(); return false; }
                return true;
            });

            gridElements[0].remove(); 
            currentLaneIndex--; roadShiftX += LANE_WIDTH;
            activeCars.forEach(car => car.laneIndex--);
            activeBarriers.forEach(bar => bar.laneIndex--);

            for (let d = 0; d < 60; d++) {
                laneDirectionMap[d] = laneDirectionMap[d + 1];
                laneBaseSpeedMap[d] = laneBaseSpeedMap[d + 1];
                safeLaneMap[d] = safeLaneMap[d + 1]; 
            }

            const adjustedBallLeft = (currentLaneIndex * LANE_WIDTH) - 9;
            playerRig.style.transition = 'none';
            roadContainer.style.transition = 'none';
            playerRig.style.left = `${adjustedBallLeft}px`;
            roadContainer.style.transform = `translate3d(${roadShiftX}px, 0, 0)`;
            void roadContainer.offsetHeight; 
            playerRig.style.transition = 'left 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
            roadContainer.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        }
    }, 300);
};

// --- GAME LOGIC ---
window.addEventListener("load", function() {
    setTimeout(function() { window.scrollTo(0, 1); }, 100);
});

function updateGameLoop(timestamp) {
    const viewportHeight = viewportArea.offsetHeight;
    const gameCenterY = viewportHeight / 2; 

    for (let i = 0; i < activeCars.length; i++) {
        const car = activeCars[i];
        const hasBarrierAhead = activeBarriers.some(b => b.laneIndex === car.laneIndex);
        
        const currentCarHeight = car.element.offsetHeight || 180;
        const stopYIncoming = (gameCenterY - 110) - currentCarHeight - CAR_STOP_GAP; 
        const stopYOutgoing = (gameCenterY + 110) + CAR_STOP_GAP;         
        const shouldObeyBarrier = hasBarrierAhead && (!isGameOver || car !== murderousCarRef);

        if (car.direction === 'incoming') {
            if (shouldObeyBarrier && car.currentTop >= stopYIncoming && car.currentTop < gameCenterY) {
                if (!car.hasBraked) { car.hasBraked = true; playSound(sndBrake); }
                car.currentTop = stopYIncoming; 
            } else {
                car.currentTop += car.speed; 
                if (car.currentTop > viewportHeight + LOOP_BOUND) {
                    car.currentTop = -LOOP_BOUND;
                    car.hasPassedBy = false;
                    car.hasBraked = false;
                }
            }
        } else {
            if (shouldObeyBarrier && car.currentTop <= stopYOutgoing && car.currentTop > gameCenterY - 250) {
                if (!car.hasBraked) { car.hasBraked = true; playSound(sndBrake); }
                car.currentTop = stopYOutgoing;
            } else {
                car.currentTop -= car.speed; 
                if (car.currentTop < -LOOP_BOUND) {
                    car.currentTop = viewportHeight + LOOP_BOUND;
                    car.hasPassedBy = false;
                    car.hasBraked = false;
                }
            }
        }

        let currentTime = Date.now();
        let canHonk = !isGameOver && (currentTime - lastHonkTime > 2500); 
        
        if (canHonk && Math.random() < 0.01) { 
            playSound(Math.random() > 0.5 ? sndHonk1 : sndHonk2);
            lastHonkTime = currentTime + (Math.random() * 3000); 
        }

        if (!car.hasPassedBy && !isGameOver && car.laneIndex === currentLaneIndex + 1) {
            let carCenter = car.currentTop + (currentCarHeight / 2);
            if ((car.direction === 'incoming' && carCenter > gameCenterY) || 
                (car.direction === 'outgoing' && carCenter < gameCenterY)) {
                car.hasPassedBy = true;
                playSound(sndPassby);
            }
        }

        const rotation = car.direction === 'outgoing' ? 'rotate(180deg)' : 'rotate(0deg)';
        car.element.style.transform = `translate3d(0, ${car.currentTop}px, 0) ${rotation}`;
        
        if (!isGameOver) checkLiveCollision(car);
    }

    if (!lastFrameTime) lastFrameTime = timestamp;
    const elapsed = timestamp - lastFrameTime;

    if (elapsed >= frameDuration) {
        if (currentCharacterState === 'jump') {
            if (currentFrameIndex < activeFramesSource.length - 1) currentFrameIndex++;
            else {
                currentCharacterState = 'idle';
                activeCharacterImg = spriteImages.idle;
                activeFramesSource = idleFrames;
                currentFrameIndex = 0;
            }
        } else if (currentCharacterState !== 'crash') {
            currentFrameIndex = (currentFrameIndex + 1) % activeFramesSource.length;
        }
        lastFrameTime = timestamp - (elapsed % frameDuration);
    }

    spriteCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);

    if (currentCharacterState === 'crash') {
        if (activeCharacterImg.complete && activeCharacterImg.naturalWidth !== 0) {
            spriteCtx.drawImage(
                activeCharacterImg,
                0, 0, activeCharacterImg.naturalWidth, activeCharacterImg.naturalHeight,
                0, 0, spriteCanvas.width, spriteCanvas.height
            );
        }
    } else {
        const frameCoords = activeFramesSource[currentFrameIndex];
        if (activeCharacterImg.complete && activeCharacterImg.naturalWidth !== 0) {
            spriteCtx.drawImage(
                activeCharacterImg,
                frameCoords.x, frameCoords.y, frameCoords.w, frameCoords.h,
                0, 0, spriteCanvas.width, spriteCanvas.height
            );
        } else {
            spriteCtx.fillStyle = isGameOver ? '#757575' : '#ff5252';
            spriteCtx.beginPath(); spriteCtx.arc(128, 128, 90, 0, Math.PI * 2); spriteCtx.fill();
        }
    }

    animationFrameId = requestAnimationFrame(updateGameLoop);
}

function generateLaneTraffic(laneElement, domLaneIdx, targetAbsIdx) {
    if (domLaneIdx === 0) return; 

    const manholeNode = document.createElement('div');
    manholeNode.classList.add('manhole');
    manholeNode.innerText = getMultiplierVal(targetAbsIdx);
    laneElement.appendChild(manholeNode);

    // on the real wallet the lane's fate is not known yet, so traffic is cosmetic.
    // in demo mode it still previews the lane, the way the standalone game did.
    const isSafeLane = wallet ? getRNG() < 0.5 : !checkIsCrashLane(domLaneIdx, targetAbsIdx);
    const direction = getRNG() < 0.5 ? 'incoming' : 'outgoing';
    laneDirectionMap[domLaneIdx] = direction;

    const baseSpeed = 4.5 + getRNG() * 3.5;
    const speed = baseSpeed * (isSafeLane ? 1.25 : 1.0); 
    laneBaseSpeedMap[domLaneIdx] = speed;
    
    let carCount = isSafeLane ? (getRNG() < 0.35 ? 0 : 1) : (1 + Math.floor(getRNG() * 2)); 

    const viewportHeight = viewportArea.offsetHeight || window.innerHeight * 0.6;
    const totalLoopDistance = viewportHeight + (LOOP_BOUND * 2);

    for (let i = 0; i < carCount; i++) {
        let startingY;
        const offset = (totalLoopDistance / carCount) * i;
        
        if (direction === 'incoming') {
            startingY = -LOOP_BOUND + offset;
        } else {
            startingY = viewportHeight + LOOP_BOUND - offset;
        }

        const carElement = document.createElement('div');
        carElement.classList.add('car', direction);
        
        const randomImgSrc = carImageAssets[Math.floor(getRNG() * carImageAssets.length)];
        carElement.style.backgroundImage = `url('${randomImgSrc}')`;
        
        const imgLoader = new Image();
        imgLoader.src = randomImgSrc;
        imgLoader.onload = function() {
            if (this.naturalWidth && this.naturalHeight) {
                carElement.style.aspectRatio = `${this.naturalWidth} / ${this.naturalHeight}`;
            }
        };
        carElement.style.aspectRatio = "46/90";

        const rotation = direction === 'outgoing' ? 'rotate(180deg)' : 'rotate(0deg)';
        carElement.style.transform = `translate3d(0, ${startingY}px, 0) ${rotation}`;
        
        laneElement.appendChild(carElement);

        activeCars.push({
            laneIndex: domLaneIdx, currentTop: startingY,
            direction: direction, speed: speed, element: carElement,
            hasBraked: false, hasPassedBy: false
        });
    }
}

function spawnInstantCrashCar(laneElement, domLaneIdx) {
    activeCars = activeCars.filter(car => {
        if (car.laneIndex === domLaneIdx) { car.element.remove(); return false; }
        return true;
    });
    isVisualCrashHappening = true;
    
    const direction = laneDirectionMap[domLaneIdx] || 'incoming';
    const fromTop = (direction === 'incoming');
    const viewportHeight = viewportArea.offsetHeight;
    const spawnY = fromTop ? -250 : (viewportHeight + 250);
    
    const baseLaneSpeed = laneBaseSpeedMap[domLaneIdx] || 6.0;
    const speed = baseLaneSpeed * 5; 

    const carElement = document.createElement('div');
    carElement.classList.add('car', direction);
    
    const randomImgSrc = carImageAssets[Math.floor(getRNG() * carImageAssets.length)];
    carElement.style.backgroundImage = `url('${randomImgSrc}')`;
    carElement.style.aspectRatio = "46/90";
    carElement.style.filter = 'drop-shadow(0px 8px 10px rgba(0,0,0,0.45)) brightness(0.7) sepia(0.2) hue-rotate(-30deg)';

    const rotation = direction === 'outgoing' ? 'rotate(180deg)' : 'rotate(0deg)';
    carElement.style.transform = `translate3d(0, ${spawnY}px, 0) ${rotation}`;
    laneElement.appendChild(carElement);

    activeCars.push({
        laneIndex: domLaneIdx, currentTop: spawnY,
        direction: direction, speed: speed, element: carElement,
        hasBraked: false, hasPassedBy: false
    });
}

function placeSafetyRoadblocks(laneElement, domLaneIdx) {
    if (domLaneIdx === 0) return;

    const rigTop = playerRig.offsetTop;
    const gameCenterY = rigTop + 64; 
    const upperBarrierY = (gameCenterY - 110); 
    const lowerBarrierY = (gameCenterY + 110); 

    const createBarrierNode = (yPos) => {
        const barrierEl = document.createElement('div');
        barrierEl.classList.add('barrier');
        barrierEl.style.top = `${yPos}px`;
        laneElement.appendChild(barrierEl);
        activeBarriers.push({ laneIndex: domLaneIdx, element: barrierEl });
    };

    createBarrierNode(upperBarrierY);
    createBarrierNode(lowerBarrierY);
}

function buildInitialHighwayLayout() {
    const sidewalk = document.createElement('div');
    sidewalk.classList.add('footpath');
    roadContainer.appendChild(sidewalk);

    for (let i = 1; i < 25; i++) {
        const lane = document.createElement('div');
        lane.classList.add('lane');
        roadContainer.appendChild(lane);
        generateLaneTraffic(lane, i, i); 
    }

    playerRig.style.left = `-9px`;
    badgeText.innerText = "1.00x";
    roadContainer.appendChild(playerRig); 
}

function checkLiveCollision(car) {
    if (car.laneIndex === currentLaneIndex) {
        const rigTop = playerRig.offsetTop;
        const liveCarHeight = car.element.offsetHeight || 180;
        
        if (rigTop + 128 >= car.currentTop && rigTop <= car.currentTop + liveCarHeight) {
            triggerCarOverDeath(car);
        }
    }
}

function triggerCarOverDeath(hittingCar) {
    isGameOver = true;
    murderousCarRef = hittingCar; 
    playSound(sndCrash);
    
    if (hittingCar.element.parentElement) {
        playerRig.style.transition = 'none'; 
        hittingCar.element.parentElement.appendChild(playerRig); 
        playerRig.style.left = "-9px"; 
        playerRig.style.zIndex = "10";
        hittingCar.element.style.zIndex = "999"; 
    }

    spriteCanvas.style.filter = 'none';
    spriteCanvas.style.transform = 'none';
    currentCharacterState = 'crash';
    activeCharacterImg = spriteImages.crash;

    const viewportHeight = viewportArea.offsetHeight;
    const distanceLeft = viewportHeight + 150;
    const durationMs = (distanceLeft / hittingCar.speed) * 16.66; 

    setTimeout(() => { resetGameToDashboard(); }, Math.min(Math.max(durationMs, 700), 1800)); 
}

function resetGameEnvironment() {
    isGameOver = false; isJumping = false;
    isVisualCrashHappening = false; murderousCarRef = null; 
    absoluteLaneIndex = 0; 
    
    for (let prop in safeLaneMap) delete safeLaneMap[prop];
    for (let prop in laneDirectionMap) delete laneDirectionMap[prop];
    for (let prop in laneBaseSpeedMap) delete laneBaseSpeedMap[prop];
    
    activeCars = []; activeBarriers = [];
    roadContainer.innerHTML = '';
    
    spriteCanvas.style.filter = 'drop-shadow(0px 8px 6px rgba(0,0,0,0.4))';
    spriteCanvas.style.transform = 'none';
    currentCharacterState = 'idle';
    activeCharacterImg = spriteImages.idle;
    activeFramesSource = idleFrames; currentFrameIndex = 0;
    
    playerRig.style.transition = 'none'; 
    playerRig.style.zIndex = "100"; 
    
    roadContainer.appendChild(playerRig); 
    currentLaneIndex = 0; roadShiftX = 0;
    roadContainer.style.transform = 'translate3d(0, 0, 0)';

    buildInitialHighwayLayout();
}

function resetGameToDashboard() {
    isGameSessionActive = false;
    activeGameControls.style.display = 'none';
    dashboardControls.style.display = 'flex';
    
    initPRNG(serverSeed, clientSeed, gameNonce); 
    resetGameEnvironment();
    paintHud();
}

// --- INITIALIZATION ---
currentBetAmount = Math.max(MIN_BET, Math.min(currentBetAmount, maxAffordableBet()));
betDisplayVal.min = MIN_BET;
betDisplayVal.max = MAX_BET;
betDisplayVal.value = currentBetAmount;
showBalance();   // the markup ships a hardcoded $100.00 placeholder
paintHud();
initPRNG(serverSeed, clientSeed, gameNonce);
buildInitialHighwayLayout();
requestAnimationFrame(updateGameLoop);
