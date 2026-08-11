// 21.11.2022

// ---simple tweens---
class SimpleTweener
{
    constructor ()
    {
        this.tweensSF = [];
    }

    update(delta)
    {
        for( var i = 0; i < this.tweensSF.length; i++){ 
    
            if ( this.tweensSF[i].complete) { 
        
                this.tweensSF.splice(i, 1); 
                i--;
            }        
        }
        this.tweensSF.forEach((t)=>{t.update(delta);});
    }

    push(tween)
    {
        this.tweensSF.push(tween);
    }
}

const simpleTweener = new SimpleTweener();

class SimpleTweenFloat
{
    constructor (contextObject, startValue, endValue, time, updateCallBack, completeCallBack)
    {
        this.contextObject = contextObject;
        this.startValue = startValue;
        this.endValue = endValue;
        this.time = time;
        this.dTime = 0;   // tween time  counter
        this.complete = false;
        this.val = startValue;
        this.updateCallBack = updateCallBack;
        this.completeCallBack = completeCallBack;
        this.delay = 0;
        this.valOld = this.val;
        simpleTweener.push(this);
    }

    update(deltaTime)
    {
        if(this.complete) return;
        this.dTime += deltaTime;
        if(this.dTime >= this.time) 
        { 
            this.dTime = this.time
            this.valOld = this.val;
            this.val = this.endValue;      
            this.updateCallBack.call(this.contextObject, this.val, this.val - this.valOld);
            this.completeCallBack.call(this.contextObject);
            this.complete = true;
        }
        else
        {
            this.valOld = this.val;
            this.val = this.lerp(this.startValue, this.endValue, this.dTime/this.time);    
            this.updateCallBack.call(this.contextObject, this.val, this.val - this.valOld);
        }
    }

    lerp(val1, val2, amount)
    {
        amount = amount < 0.0 ? 0.0 : amount;
        amount = amount > 1.0 ? 1.0 : amount;
        return val1 + (val2 - val1) * amount;
    }
}

class SimpleWaitWhile{
    constructor (contextObject, condition, completeCallBack)
    {
        this.contextObject = contextObject;
        this.completeCallBack = completeCallBack;
        this.condition = condition;
        simpleTweener.push(this);
    }

    update(deltaTime)
    {
        if(this.complete) return;
        if(this.condition() === true) 
        {     
            this.completeCallBack.call(this.contextObject);
            this.complete = true;
        }
    }
}
// ---end simple tweens---

class SequenceTweener
{
    constructor ()
    {
        this.tweensSF = [];
    }

    update(delta)
    {
        if(this.tweensSF.length == 0) return;
        for( var i = 0; i < this.tweensSF.length; i++){ 
    
            if ( this.tweensSF[i].complete) { 
        
                this.tweensSF.splice(i, 1); 
                i--;
            }        
        }
        if(this.tweensSF.length == 0) return;
        this.tweensSF[0].update(delta);
    }

    push(tween)
    {
        this.tweensSF.push(tween);
    }
}

// Helper class to make combinations
class ComboCounter
{  
    constructor(maxCounterValues) // positions [max Val0, max Val1, max Val2, ...]
    {
        this.maxCounterValues = maxCounterValues;
        this.combo = [];
        this.maxCounterValues.forEach((p)=>{
            this.combo.push(0);
        });
        this.firstCombo = true;
    }

    nextCombo()
    {
        if(this.firstCombo)
        {
            this.firstCombo = false;
            return true;
        }
        for (var i = this.maxCounterValues.length - 1; i >= 0; i--)
        {
            if (this.combo[i] < this.maxCounterValues[i])
            {
                this.combo[i]++;
                if (i != this.maxCounterValues.length - 1) // reset low "bits"
                {
                    for (var j = i + 1; j < this.maxCounterValues.length; j++)
                    {
                        this.combo[j] = 0;
                    }
                }
                return true;
            }
        }
        return false;
    }

    sum()
    {
        var s = 0;
        this.combo.forEach((ci)=>{s+=ci;});
        return s;
    }

    getComboCounts()
    {
        var counts = 1;
        this.maxCounterValues.forEach((p)=>{
            if(p != 0) counts*= p;
        });
    }
}

class Coroutiner{
   
    constructor(scene, generator)
    {
        this.scene = scene;
        this.complete = false;
        this.generator = generator;
    }

    start()
    {
        this.complete = false;
        this.scene.updateEvent.add(this.update, this);
    }

    stop()
    {
        this.complete = true;
        this.scene.updateEvent.remove(this.update);
       // console.log('stop generator');
    }

    update(time, delta)
    {
      if(this.complete) return;
      var gen = this.generator.next();
      this.complete = gen.done;
      if(this.complete) { this.stop();}
    }
}

class ParallelActions{

    constructor()
    {
        this.count = 0;
        this.ended = 0;
        this.seqL = [];
    }

    add(action)
    {
        this.seqL.push(action);
        this.count++;
    }

    start(completeAction)
    {
        if (this.seqL.length > 0)
        {
            for (var i = 0; i < this.seqL.length; i++)
            {
                this.seqL[i](() => { this.ended++; if (this.ended == this.count) { if(completeAction!=null) completeAction(); } });
            }
        }
        else
        {
           if(completeAction!=null) completeAction();
        }
    }
}

// ---sequenced actions---
class SequencedActions{

    constructor()
    {
        this.isComplete = false;
        this.seqL = [];
        this.complCallBack = null;
        this.breakSeq = false;
    }

    start()
    {
        this.breakSeq = false;
        this.isComplete = false;
        if (this.breakSeq) return;
        this.add(this.completeAction, this);
        this.seqL[0].invoke();
    }

    add(action, context)
    { 
        var actionW = new SequenceActionWrapper(action, context);
        if(this.seqL.length > 0)
        {
            this.seqL[this.seqL.length-1].nextActionWrapper = actionW;
        }
        this.seqL.push(actionW); 
    }

    break()
    {
        this.breakSeq = true;
        this.isComplete = true;
        this.seqL.forEach((sAW)=>{sAW.break = true;});
    }

    completeAction(callBack){
        this.isComplete = true;
    }
}

class SequenceActionWrapper
{
    constructor(action, context)
    {
        this.action = action;
        this.nextActionWrapper = null;
        this.break = false;
        this.context = context;
    }

    invoke()
    {
       if(!this.break && this.action!=null) this.action.call(this.context, ()=>{ if (this.nextActionWrapper != null) this.nextActionWrapper.invoke();});
    }
}
// ---end sequenced actions---

class EventWrapper
{
    constructor(action, context)
    {
        this.action = action;
        this.context = context;
    }
}

class MKEvent{

    constructor(){
        this.events = [];
    }

    add(action, context){
       var eventWrapper = new EventWrapper(action, context);
       this.events.push(eventWrapper);
    }

    remove(action)
    {
        for(var i=0; i < this.events.length; i++){
            if(this.events[i].action == action)
            {
                this.events.splice(i, 1);
            }
        }
    }

    invoke()
    {
        this.events.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context);});
    }
}

class SceneButton
{
    constructor (scene, spriteNormal, spriteHover, isSwitch)
    {
        this.spriteNormal = spriteNormal;
        this.spriteHover = spriteHover;
        this.scene = scene;
        this.clickEvent = new MKEvent();
        this.pointerDownEvent = new MKEvent();
        this.pointerUpEvent = new MKEvent();
        this.pointerOverEvent = new MKEvent();
        this.pointerOutEvent = new MKEvent();
        this.isSwitch = isSwitch;
    }
    
    create(offsetX, offsetY, originX, originY)
    { 
        this.offsetX = offsetX;
        this.offsetY = offsetY;
        this.originX = originX;
        this.originY = originY;

        this.posX = this.scene.centerX + this.offsetX;
        this.posY = this.scene.centerY + this.offsetY;

        this.button = this.scene.add.sprite(this.posX, this.posY, this.spriteNormal).setOrigin(originX, originY);    
        this.button.on('pointerdown',this.pointerDown,this);
        this.button.on('pointerup',this.pointerUp,this);
        this.button.on('pointerover',this.pointerOver,this);
        this.button.on('pointerout',this.pointerOut,this);
        this.button.setInteractive();
        this.interactable = true;
        this.pressed = false;
        this.pDown = false;
    }

    pointerUp() 
    {
        if(!this.interactable) return;
        if(!this.pDown) return;
        this.pDown = false;
        if(!this.isSwitch) this.pressed = false;        
        this.button.setTexture( this.pressed ? this.spriteHover : this.spriteNormal);
        this.pointerUpEvent.invoke();
        this.clickEvent.invoke();
    }

    pointerDown() 
    {   
        if(!this.interactable) return;
        this.pDown = true;
        if(this.isSwitch) this.pressed = !this.pressed;  
        this.button.setTexture(this.spriteHover);
        this.pointerDownEvent.invoke();
         // console.log('button down', arguments);
    }

    pointerOver() 
    {
        if(!this.interactable) return;
        this.pointerOverEvent.invoke();
       // this.button.setTexture(this.spriteHover);
    }

    pointerOut() 
    {  
        if(!this.interactable) return;
        this.pointerOutEvent.invoke();
       // this.button.setTexture(this.spriteNormal);
    }  
    
    setInteractable(interactable){
        this.interactable = interactable;
    }

    addClickEvent(action, context)
    {
        this.clickEvent.add(action, context);
    }

    release()
    {
        this.pressed = false;
        this.button.setTexture( this.pressed ? this.spriteHover : this.spriteNormal);
    }

    setPressed()
    {
        this.pressed = true;
        this.button.setTexture( this.pressed ? this.spriteHover : this.spriteNormal);
    }

    setDepth(depth){
        this.button.depth = depth;
    }

  
}

class StateMachine
{
    initialize(startingState)
    {
        this.currentState = startingState;
        console.log(this.currentState.toString());
        this.currentState.enterFrom(null);
    }

    changeState(newState)
    {
        console.log('ChangeState; oldstate: ' + ((this.currentState === null) ? 'null': this.currentState.toString()) + '; newState: ' + ((newState === null) ? 'null' : newState.toString()));
        var old = this.currentState;
        this.currentState.exitTo(newState);
        this.currentState = newState;
        newState.enterFrom(old);
    }
}

class SoundController
{
    constructor(scene)
    {
        this.scene = scene;
        this._musicOn = true;
        this._soundOn = true;
        this.music = null;
        this.sounds = [];
    }

    soundOn(soundOn)
    {
        this._soundOn = soundOn;
        this._refreshSoundSources();
    }

    musicOn(musicOn)
    {
        this._musicOn = musicOn;
        this._refreshSoundSources();
    }

    playClip(clip, loopSound)
    {
        if(this.scene[clip] !== undefined && this._soundOn)
        {
            this.scene[clip].play({loop: loopSound});
            this.sounds.push(clip);
        }
    }

    stopClip(clip)
    {   
        if(this.scene[clip] !== undefined)
        {
            this.scene[clip].stop();
        }
    }

    playMusic(clip)
    {
        if(this.music!==null && this.music !== clip ){
            this.music.stop();
        }
        this.music = this.scene[clip];
        if(!this._musicOn) return;
        this.music.play({loop: true});
    }

    stopMusic()
    {
        if(this.music !== null){
            this.music.stop();
        }
    }

    stopSounds(){
        console.log('this.sounds.length: ' + this.sounds.length)
        this.sounds.forEach((s)=>{console.log('sound: ' + s); this.scene[s].stop();});
    }

    _refreshSoundSources()
    {
        if(!this._musicOn)
        {
            this.stopMusic();
        }
        else
        {
            if(this.music !== null)
            {
                this.music.play();
            }
        }

        if(!this._soundOn)
        {
            this.stopSounds();
        }
    }

    stopAll()
    {
        this.scene.sound.stopAll();
    }
}

class GuiController
{
    constructor(scene)
    {
        this.scene = scene;
        this.popups = [];
    }

    // message with yes, no, close buttons
    showMessageYNC(caption, message, context, okClickHandler, noClickHandler, closeClickHandler)
    {
        var pu = new PopUpController(this.scene, this);
        pu._show(createGameMessagePUHandlerYNC);
        pu.wCont.depth = 1000;
        pu.captionText.text = caption;
        pu.messageText.text = message;

        if(okClickHandler == null && pu.okButton!== null)
        {
            pu.okButton.button.destroy();
        }
        else if(pu.okButton!== null)
        {
            pu.okButton.clickEvent.add(okClickHandler, context);
        }
        if(noClickHandler == null && pu.noButton !== null)
        {
            pu.noButton.button.destroy();
        }
        else if (pu.noButton !== null)
        {
            pu.noButton.clickEvent.add(noClickHandler, context);
        }
        if(closeClickHandler == null && pu.exitButton !== null)
        {
            pu.exitButton.button.destroy();
        }
        else if(pu.exitButton !== null)
        {
            pu.exitButton.clickEvent.add(closeClickHandler, context);
        }
        this.popups.push(pu);
        return pu;
    }

    // message with close button
    showMessage(caption, message, context, closeClickHandler)
    {
        var pu = new PopUpController(this.scene, this);
        pu._show(createGameMessagePUHandler);
        pu.wCont.depth = 1000;
        pu.captionText.text = caption;
        pu.messageText.text = message;
    
        if(closeClickHandler == null && pu.exitButton !== null)
        {
            pu.exitButton.button.destroy();
        }
        else if(pu.exitButton !== null)
        {
            pu.exitButton.clickEvent.add(closeClickHandler, context);
        }
        this.popups.push(pu);
        return pu;
    }

    showPopUp(createPopupEvent)
    {
        var pu = new PopUpController(this.scene, this);
        pu._show(createPopupEvent);
        pu.wCont.depth = 1000;
        this.popups.push(pu);
        return pu;
    }

    closePopUp(popUp)
    {
        // console.log('this.popups.length before close: ' + this.popups.length)
        for(var i = 0; i < this.popups.length; i++)
        {
            if(this.popups[i] == popUp)
            {
                this.popups.splice(i, 1);
            }
        }
        popUp.wCont.destroy();
        // console.log('this.popups.length after close: ' + this.popups.length)
    }

    setInteractable(interactable)
    {
        this.popups.forEach((pu)=>{if(pu!==null) pu.setControlsInteractable(interactable);});
    }

    hasNoPopUp()
    {
       return this.popups.length === 0;
    }

}

class PopUpController
{
    constructor(scene, guiController)
    {
        this.scene = scene;
        this.guiController = guiController;
        this.createEvent = null;
        this.buttons = [];
    }

    _show(createEventHandler)
    {
        this.wCont = this.scene.add.container(this.scene.centerX, this.scene.centerY);
        this.createEvent = createEventHandler;
        if(this.createEvent !== null) this.createEvent(this);
    }

    setControlsInteractable(interactable)
    {
        this.buttons.forEach((b)=>{if(b!==null) b.setInteractable(interactable)});
    }

    addButton(buttonName, spriteNormal, spriteHover, isSwitch, lPosX, lPosY)
    {
        this[buttonName] = new SceneButton(this.scene, spriteNormal, spriteHover, isSwitch);
        this[buttonName].create(0, 0, 0.5, 0.5);
        this.wCont.add(this[buttonName].button);
        this[buttonName].button.setPosition(lPosX, lPosY);
        this.buttons.push(this[buttonName]);
    }

    add(guiObject) // guiObject: sprite, text, container
    {
        this.wCont.add(guiObject);
    }
}


