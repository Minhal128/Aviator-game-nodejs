// audio.js
export const sndBgm = new Audio('assets/audio/bgm.mp3'); 
sndBgm.loop = true;
export const sndCrash = new Audio('assets/audio/crash.mp3');
export const sndPassby = new Audio('assets/audio/passby.mp3');
export const sndHonk1 = new Audio('assets/audio/honk1.mp3');
export const sndHonk2 = new Audio('assets/audio/honk2.mp3');
export const sndBrake = new Audio('assets/audio/brake.mp3');
export const sndGo = new Audio('assets/audio/go.mp3');
export const sndCashout = new Audio('assets/audio/cashout.mp3');
export const sndButton = new Audio('assets/audio/buttons.mp3');

let sfxVolume = 1.0;

export function handleMusicVolumeChange(val) {
    sndBgm.volume = parseFloat(val);
    if (sndBgm.volume > 0 && sndBgm.paused) {
        sndBgm.play().catch(e => console.log("Waiting for user interaction to play BGM"));
    }
}

export function handleSfxVolumeChange(val) {
    sfxVolume = parseFloat(val);
}

export function playSound(audioObj) {
    if (sfxVolume > 0 && audioObj) {
        let snd = audioObj.cloneNode();
        snd.volume = sfxVolume;
        snd.play().catch(e => {});
    }
}
