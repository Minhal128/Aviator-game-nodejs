// math.js
export const GAME_MODES = {
    easy:     { rtp: 0.97,  baseSurvival: 0.96, maxSteps: 40, volatility: 0.15, decay: 0.005 },
    medium:   { rtp: 0.96,  baseSurvival: 0.92, maxSteps: 30, volatility: 0.25, decay: 0.010 },
    hard:     { rtp: 0.955, baseSurvival: 0.85, maxSteps: 20, volatility: 0.40, decay: 0.018 },
    hardcore: { rtp: 0.94,  baseSurvival: 0.75, maxSteps: 15, volatility: 0.65, decay: 0.025 }
};

function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
        k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [(h1^h2^h3^h4)>>>0, (h2^h1)>>>0, (h3^h1)>>>0, (h4^h1)>>>0];
}

function sfc32(a, b, c, d) {
    return function() {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; 
      var t = (a + b | 0) + d | 0;
      d = d + 1 | 0;
      a = b ^ b >>> 9;
      b = c + (c << 3) | 0;
      c = c << 21 | c >>> 11;
      c = c + t | 0;
      return (t >>> 0) / 4294967296;
    }
}

export let getRNG = Math.random; 

export function initPRNG(serverSeed, clientSeed, gameNonce) {
    let seedStr = `${serverSeed}:${clientSeed}:${gameNonce}`;
    let seed = cyrb128(seedStr);
    getRNG = sfc32(seed[0], seed[1], seed[2], seed[3]);
}

export function calculateMultiplierForIndex(targetIdx, difficultyLevel) {
    if (targetIdx <= 0) return "1.00x";
    
    let modeKey = difficultyLevel || 'medium';
    let mode = GAME_MODES[modeKey] || GAME_MODES.medium;
    
    let compounded = 1.0;
    for (let i = 1; i <= targetIdx; i++) {
        let survival = Math.max(0.05, mode.baseSurvival - (i * mode.decay));
        compounded *= survival;
    }
    
    let rawMult = mode.rtp / compounded;
    let volatilityBonus = 1 + (mode.volatility * Math.pow(targetIdx / mode.maxSteps, 1.6));
    let finalMult = Math.max(1.01, rawMult * volatilityBonus);
    
    return `${finalMult.toFixed(2)}x`;
}
