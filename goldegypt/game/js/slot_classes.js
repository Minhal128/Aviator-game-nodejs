class Lamp
{
    constructor (scene, offsetX, offsetY)
    {
        this.scene = scene;
        this.lamp = scene.addSpriteLocPos('lamp_off', offsetX, offsetY);  
    }

    on()
    {
        this.lamp.setTexture('lamp_on'); 
    }

    off()
    {
        this.lamp.setTexture('lamp_off'); 
    }

    setOn(lampOn)
    {
        this.lamp.setTexture(lampOn ? 'lamp_on' : 'lamp_off'); 
    }
}

class TimeCoder{
 
    // use this.lampsTimeCoder = new TimeCoder(this, '00110011', 500, (on)=>{this.lampsArray.forEach((l)=>{l.setOn(on);})}); // code lamps signals 0-off 1-on, 200 - loop time
    constructor (scene, timeCode, interval, changeStateEvent)
    {
        this.scene = scene;
        this.timeCode = timeCode;
        this.interval = interval;
        this.timeArray = [];
        this.fullTime = timeCode.length * interval;
        this.started = false;
        this.changeStateEvent = changeStateEvent;
        this.oldState = false;

        for (let i = 0; i < timeCode.length; i++) {
            if(timeCode[i] ==='0')
            {
                this.timeArray.push({time: i * interval, state :  false});
            }
            else{
                this.timeArray.push({time: i * interval, state :  true});
            }
          }

          this.delta = 0;
    }

    update(deltaMillis)
    {
        this.state = this.getState().state;
        if(!this.started)
        {
            this.started = true;         
            this.changeStateEvent.call(this.scene, this.state);
            this.oldState = this.state;
        }

        this.delta += deltaMillis;
        if(this.delta >= this.fullTime)
        {
            this.delta = 0;
        }

        if(this.state !== this.oldState){
            this.changeStateEvent.call(this.scene, this.state);
            this.oldState = this.state;
        }
    }

    getState(){
        let index = Math.floor(this.delta / this.interval);
        if(index > this.timeCode.length-1) index = this.timeCode.length-1;
        return this.timeArray[index];
    }

    start(){

    }

    stop(){
        
    }
}

class LineButton
{
    constructor (scene, spriteNormal, spriteHover, number)
    {
        this.spriteNormal = spriteNormal;   // normal texture name
        this.spriteHover = spriteHover;     // hover texture name
        this.scene = scene;
        this.number = number;
        this.pressed = false;
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
        this.pointerDownEvents = [];
        this.lineText = this.scene.add.bitmapText(this.posX, this.posY-2, 'gameFont', this.number, 30, 1).setOrigin(0.5);
        this.lineText.tint = 0x000000;
    }

    pointerUp() 
    {
        if(!this.interactable) return;
        this.setStateTexture();
    }

    pointerDown() 
    {   
        if(!this.interactable) return;
        this.pointerDownEvents.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context); });
    }

    pointerOver() 
    {
        if(!this.interactable) return;
    }

    pointerOut() 
    {  
        if(!this.interactable) return;
    }  
    
    setInteractable(interactable){
        this.interactable = interactable;
    }

    setStateTexture()
    {
       this.button.setTexture(this.pressed ? this.spriteHover : this.spriteNormal);
    }

    setState(pressed)
    {
        this.pressed = pressed;
        this.setStateTexture();
    }

    addPointerDownEvent(action, context)
    {
        if(action != null)  this.pointerDownEvents.push(new EventWrapper (action, context));
    }
}

class SlotSymbol
{
    constructor (scene, sprite, blurTexture, posY, frameRate)
    {
        this.scene = scene;
        this.sprite = sprite;
        this.sprite.depth = -1;
        this.normalTexture = sprite.texture;
        this.blurTexture = blurTexture;
        this.posY = posY;
        this.orderOnReel = 0;
        this.sprite.setPosition(this.sprite.x, Math.round(this.posY));
        //this.sprite.setVisible(false);
        this.frameRate = frameRate;
        // create symbols animation
        this.symbolAnim = this.scene.anims.create({
            key: this.sprite.name + 'anim',
            frames: this.scene.anims.generateFrameNumbers(this.sprite.name + 'Sheet'),
            frameRate: this.frameRate,
            repeat: -1
        });
       this.anim = null;
       this.blur = false;
       this.posX = this.sprite.x;
    }

    setPositionY(posY)
    {
        this.posY = posY;
        this.sprite.setPosition(this.posX, Math.round(this.posY));
    }

    setIcon(icon)
    {
        this.sprite.setTexture(this.blur ? this.blurTexture : this.normalTexture);
        this.sprite.name = icon;
    }

    showAnim(show)
    {
        if(show)
        {
            if(this.anim == null)
            {
                this.sprite.setVisible(false);
                this.anim = this.scene.add.sprite(this.sprite.x, this.posY, this.sprite.name + 'Sheet').setOrigin(0.5).play({ key: this.sprite.name + 'anim'});  // , frameRate : this.frameRate
                this.anim.depth = 10;
            }
        }

        else
        {
            this.sprite.setVisible(true);
            if(this.anim !== null){ this.anim.stop();  this.anim.destroy();}
            this.anim = null;
        }
    }

    setBlur(blur)
    {
        if(this.blur === blur) return;
        this.blur = blur;
        this.sprite.setTexture(blur ? this.blurTexture : this.normalTexture);
    }

    setVisible(visible)
    {
        this.sprite.setVisible(visible);
    }
}

class Reel{

    constructor (scene, reelData, reelNumber, symbolSizeY, windowsCount, randomStartPosition, spinTime, animFrameRate)
    {
        this.scene = scene;
        this.reelData = reelData;
        this.symbOrder = reelData.symbolImages;  
        this.maskImage = reelData.maskImage;
        this.posX = scene.centerX + reelData.offsetX;
        this.posY = scene.centerY + reelData.offsetY;
        this.reelNumber = reelNumber;
        this.symbolSizeY = symbolSizeY;
        this.symbols = [];
        this.symbolSpites = [];
        this.randomStartPosition = randomStartPosition;
        this.windowsCount = windowsCount;
        this.spinTime = spinTime;
        this.speed = 0;
        this.blur = false;
        this.animFrameRate = animFrameRate;
        this._create();
    }

    _create() 
    {
        this.windowOffsetY = (this.windowsCount - 1) / 2 * this.symbolSizeY;    // 0 window offset
        this.windowPosY = this.posY + this.windowOffsetY;                       // 0 window position
        this.visibleMaxY = this.getWindowPosition(0).y + this.symbolSizeY * 0.8; // 0.6;
        this.visibleMinY = this.getWindowPosition(this.windowsCount - 1).y - this.symbolSizeY * 0.8; // 0.6;

       // this.scene['reel' + this.reelNumber] = this.scene.add.image(this.posX, this.posY, this.reelData.windowImage);                              // add window image sprite
       // this.scene['reel' + this.reelNumber].depth = -3;
        
        // create geometry mask

        var shape = this.scene.make.graphics();
        shape.fillStyle(0xffffff);
        shape.beginPath();
        shape.fillRect(this.posX - this.symbolSizeY * 0.6, this.windowPosY + this.symbolSizeY * 0.5,  this.symbolSizeY * 1.2, -this.windowsCount * this.symbolSizeY * 1.0);
        var gMask = shape.createGeometryMask();
         /*       */
        for(var si = 0; si < this.symbOrder.length; si++)
        {
            var symbName = this.symbOrder[si];
            var posY = this.windowPosY - (si * this.symbolSizeY);
            var symbSprite = this.scene.add.image(this.posX, posY, symbName);   
            symbSprite.name = symbName;                         // set name                
            symbSprite.setMask(gMask);                        // apply mask
            var symbol = new SlotSymbol(this.scene, symbSprite, symbName + 'Blurred',  posY, this.animFrameRate);
            this.setIconAndAddAtTop(symbol)
            this.symbols.push(symbol);
            this.symbolSpites.push(symbSprite);
        }

        if (this.symbols.length < this.windowsCount)
        {
            console.log("Reel " +this.reelNumber +  ": symbols tape size< slot window size, add symbols");
        }

        var invisibleSymbols = this.symbols.length - this.windowsCount;
        this.halfInvis = Math.floor(invisibleSymbols / 2);
        this.minBottomSymbPos = this.windowPosY + this.halfInvis * this.symbolSizeY; // 
        this.maxTopSymbPos = this.windowPosY - (this.halfInvis + this.windowsCount - 1) * this.symbolSizeY;
        this.currOrderPosition = 0;
        this.nextOrderPosition = 0;
        this.arrangeBottomTapePart();

         // set random start position
         if (this.randomStartPosition)
         {
             this.nextOrderPosition =  this.getRandomOrderPosition();
             var distY = this.getDistToNextSymb(this.nextOrderPosition);
             this.symbolsMove(0, distY);
             this.currOrderPosition = this.nextOrderPosition;
             this.arrangeTape();
         }
    
        this.canSpin = true;

        this.symbols.forEach((s)=>{s.setVisible(s.posY <= this.visibleMaxY && s.posY >= this.visibleMinY);});
        // this.scene.updateEvent.add(this.update, this);
    }

    spin(nextOrderPosition, completeCallBack)   // spin down
    {
       // var nextOrderPosition = this.getRandomOrderPosition();
        var spinTime = this.spinTime + this.reelData.addSpinTime;
        if(!this.canSpin) return;
        this.canSpin = false;
        var distY = this.getDistToNextSymb(nextOrderPosition);
        var count = distY / this.symbolSizeY;
        count += this.symbols.length; 
        var timePS = spinTime / count;
        this.nextOrderPosition = nextOrderPosition;

        var sA = new SequencedActions(); // spin sequence: 1 symbol back -> (main spin + 2 symbols) -> 1 symbol back

        sA.add((callBack) =>{
            new SimpleTweenFloat(this, 0.0, -this.symbolSizeY, timePS * 1.5,                                                        // 1 symbol back
            (p, dp) =>{ this.symbolsMove(p,dp);  this.arrangeBottomTapePart(); },   
            ()=> { this.arrangeBottomTapePart(); this.setBlur(true); callBack(); });
        }, this);

        sA.add((callBack) =>{
            new SimpleTweenFloat(this, 0.0, this.symbolSizeY * (count + 2), spinTime,                                               // main spin
            (p, dp) =>{this.symbolsMove(p,dp); this.arrangeTopTapePart();},   
            ()=> {this.arrangeTopTapePart(); this.setBlur(false); callBack();});
        }, this);

        sA.add((callBack) =>{
            new SimpleTweenFloat(this, 0.0, -this.symbolSizeY, timePS * 1.5,                                                        // 1 symbol back
            (p, dp) =>{this.symbolsMove(p,dp); this.arrangeBottomTapePart(); },  
            ()=> {this.arrangeBottomTapePart(); this.currOrderPosition = this.nextOrderPosition; callBack(); });        
        }, this);

        sA.add((callBack) =>{
            this.canSpin = true; 
            console.log(this.reelNumber + ' - reel spin complete');
            completeCallBack(); 
            callBack();
        }, this);

        sA.start();
    }

    symbolsMove(posY, dPos)
    {
        this.symbols.forEach((s)=>{
            s.setPositionY(s.posY + dPos);
            s.setVisible(s.posY <= this.visibleMaxY && s.posY >= this.visibleMinY);
            });
    }

    getBottomSymbol()   // positive axe down
    {
        var symb = this.symbols[0];
        this.symbols.forEach((s)=>{ if(s.posY > symb.posY)  symb = s; });
        return symb;
    }

    getTopSymbol()      // positive axe down
    {
        var symb = this.symbols[0];
        this.symbols.forEach((s)=>{ if(s.posY < symb.posY)  symb = s; });
        return symb;
    }

    setIconAndAddAtTop(slotSymbol)
    {
        var topSymbol = this.getTopSymbol();
        if (topSymbol === slotSymbol) return;

        var symbPosY = (topSymbol) ? topSymbol.posY - this.symbolSizeY : this.windowPosY;
        var newSymbolOrder = (topSymbol) ? topSymbol.orderOnReel + 1 : 0;
        if (newSymbolOrder > this.symbOrder.length - 1) newSymbolOrder = 0;
        slotSymbol.setPositionY(symbPosY);
        var symID = this.symbOrder[newSymbolOrder];         // получаем имя символа 
        slotSymbol.setIcon(symID);
        slotSymbol.orderOnReel = newSymbolOrder;
    }

    setIconAndAddAtBottom(slotSymbol)
    {
        var bottomSymbol = this.getBottomSymbol();
        if (bottomSymbol === slotSymbol) return;
        var symbPosY = (bottomSymbol) ? bottomSymbol.posY + this.symbolSizeY : this.windowPosY;
        var newSymbolOrder = (bottomSymbol) ? bottomSymbol.orderOnReel - 1 : 0;
        if (newSymbolOrder < 0 ) newSymbolOrder = this.symbOrder.length - 1;
        slotSymbol.setPositionY(symbPosY);
        var symID = this.symbOrder[newSymbolOrder];         // получаем имя символа 
        slotSymbol.setIcon(symID);
        slotSymbol.orderOnReel = newSymbolOrder;
      //  if(this.reelNumber == 0) console.log('slotSymbol:' + slotSymbol.sprite.name + '; posY: ' + slotSymbol.posY + '; order: ' + slotSymbol.orderOnReel);
    }

    //arrange tape symbols above and below the window
    arrangeTape()
    { 
        this.arrangeBottomTapePart();
        this.arrangeTopTapePart();
    }

    arrangeBottomTapePart()
    {
        // control bottom
        var botSymbol = this.getBottomSymbol();
        var botPosY = botSymbol.posY;
        var delta = -botPosY + this.minBottomSymbPos;
        if (delta > 0) 
        {
            var sCount = Math.round (delta / this.symbolSizeY);
            for (var  i = 0;  i < sCount;  i++)
            {
                var topSymbol = this.getTopSymbol();
                this.setIconAndAddAtBottom(topSymbol);
            }
        }
    }

    arrangeTopTapePart()
    {
        // control top
        var topSymbol = this.getTopSymbol();
        var topPosY = topSymbol.posY;
        var delta = -this.maxTopSymbPos + topPosY;
        if (delta > 0) 
        {
            var sCount = Math.round(delta / this.symbolSizeY);
            for (var i = 0; i < sCount; i++)
            {
                var botSymbol = this.getBottomSymbol();
                this.setIconAndAddAtTop(botSymbol);
            }
        }
    }

    // return symbols from windows
    getWindowsSymbols(orderPosition)
    {
        var vSymbols = [];
        for(var si = 0; si < this.windowsCount; si++)
        {
            var order = orderPosition + si;
            if(order > this.symbols.length - 1 )
            {
                order = order % this.symbols.length;
            }
            vSymbols.push(this.symbols[order]);
           // console.log(this.reelNumber + ':' + this.symbols[order].sprite.name);
        }
        return vSymbols;
    }

    findWindowsSymbols(spriteName)
    {
        var vSymbols = this.getWindowsSymbols(this.currOrderPosition);
        var found = [];
        vSymbols.forEach((s)=>{

            if(s.sprite.name === spriteName) found.push(s);
        });
        return found;
    }

    getDistToNextSymb(nextOrderPosition)
    {
        if (this.currOrderPosition < nextOrderPosition)
        {
            return (nextOrderPosition - this.currOrderPosition) * this.symbolSizeY;
        }
        return (this.symbOrder.length - this.currOrderPosition + nextOrderPosition) * this.symbolSizeY;
    }

    getRandomOrderPosition()
    {
        return  Phaser.Math.Between(0, this.symbols.length - 1);
    }

    getWindowPosition(windowNumber)
    {
        return new Phaser.Math.Vector2(this.posX, this.windowPosY - windowNumber * this.symbolSizeY);
    }

    getWindowSymbol(windowNumber)
    {
        var wSymbols = this.getWindowsSymbols(this.currOrderPosition);
        return wSymbols[windowNumber];
    }

    setBlur(blur)
    {
        if(this.blur === blur) return;
        this.blur = blur;
        this.symbols.forEach((s)=>{s.setBlur(blur);});
    }
}

class LineBehavior
{
    constructor (scene, linesController, lineData, lineButton, number, color)
    {
        this.scene = scene;
        this.isSelected = false;
        this.lineData = lineData;           // windows numbers
        this.isWinningLine = false;      
        this.linesController = linesController;
        this.wonSpins = 0;
        this.wonCoins = 0;
        this.lineButton = lineButton; // optional
        this.changeSelectionEvents = [];
        this.win = null;
        this.number = number;
        this.timeoutID = -1;
        this.winTimeoutID = -1;
        this.flTimerId = -1;
        this.isVisible = false;
        this.color = color;
        this.create();
    }

    create ()
    {
       this.graphics = this.scene.add.graphics();
       this.graphics.depth = 20;
       this.graphics.lineStyle(3, this.color, 1);
       this.linePoints = [];
       for(var i = 0; i < this.lineData.length; i++)
       {
            this.linePoints.push(this.linesController.reels[i].getWindowPosition(this.lineData[i]));
       }
       for(var i = 0; i < this.linePoints.length-1; i++)
       {
            var p1 = this.linePoints[i];
            var p2 = this.linePoints[i+1];
            this.lineSegment = this.graphics.lineBetween(p1.x, p1.y, p2.x, p2.y);
       }
       if(this.lineButton != null) this.lineButton.addPointerDownEvent(this.buttonClickHandler, this); 
       
      this.setLineVisible(false);
    }

    select(burn)
    {
        this.isSelected = true;
        this.lineBurn(burn);
        if(this.lineButton != null) this.lineButton.setState(true);
        this.changeSelectionEvents.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, true); });
    }

    deselect()
    {
        this.isSelected = false;
        this.lineBurn(false);
        if(this.lineButton != null) this.lineButton.setState(false);
        this.changeSelectionEvents.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, false); });
    }

    setLineVisible(visible)
    {
        this.graphics.setVisible(visible);
        this.isVisible = visible;
    }

    // show the line briefly
    lineBurn(burn)
    {
        if(!burn)
        {
            if(this.timeoutID !== -1) clearTimeout(this.timeoutID);
            this.setLineVisible(false);
        }
        else
        {  
            if(this.timeoutID !== -1) clearTimeout(this.timeoutID);
            this.setLineVisible(true);
            this.timeoutID = setTimeout(() => {
                this.setLineVisible(false);
              }, 1000);
           
        }
    }

    lineFlashing(flashing)
    {
        if(flashing && this.flTimerId ===-1) 
        {
            this.flTimerId = setInterval(() =>{ this.setLineVisible(!this.isVisible);}, 1000);
        }
        else if (flashing){         // flashing already started

        }
        else                        // cancel flashing
        {
            clearInterval(this.flTimerId);
            this.flTimerId = -1;
        }
    }

    // Find  and fill winning symbols list  from left to right, according pay lines
    findWin(payTable)
    {
        this.win = null;
        payTable.forEach((item)=>
        {
            // find max win (or win with max symbols count)
            var winTemp = this.getPayLineWin(item);
            if (winTemp != null)
            {
                if(this.win == null)
                {
                    this.win = winTemp;
                }
                else
                {
                    if(this.win.Pay < winTemp.Pay || this.win.FreeSpins < winTemp.FreeSpins)
                    {
                        this.win = winTemp;
                    }
                }      
            }
            });
    }

    //Check if line is wonn, according payline
    getPayLineWin(payLine)
    {
        if (payLine == null) return null;
        var winSymbols = [];
        for(var i = 0; i < this.lineData.length; i++)
        {
            var s =  this.linesController.reels[i].getWindowSymbol(this.lineData[i]);
            if (payLine.line[i] !== 'any' && s.sprite.name !== payLine.line[i])
            {
                return null;
            }
            else if (payLine.line[i] !== 'any' && s.sprite.name === payLine.line[i])
            {
                winSymbols.push(s);
            }
        }
        return new WinData(winSymbols, payLine.freeSpins, payLine.pay);
    }

    // Reset old winnig data 
    resetLineWinning()
    {
        this.win = null;
    }

    buttonClickHandler()
    {
        this.linesController.lineButton_Click(this);
        this.scene.soundController.playClip('button_click');
        console.log('click line button: ' + this.number);
    }

    addChangeSelectionEvent(action, context)
    {
        if(action != null)  this.changeSelectionEvents.push(new EventWrapper (action, context));
    }

    lineWinPlay(playTime, completeCallBack)
    {
        let isWinTweenComplete = false;
        if (this.win === null || this.win.symbols === null)
        {
            completeCallBack(this.win);
            return;
        }

        var pt = new ParallelActions();
        this.win.symbols.forEach((s)=>{
            pt.add((callBack) =>
            {
                s.showAnim(true);
                this.winTimeoutID = setTimeout(()=>{ callBack(); }, playTime);
            });

        });

        pt.start(() =>
        {
            isWinTweenComplete = true;
            this.lineWinCancel();
            completeCallBack(this.win);
        });
    }

    lineWinCancel()
    {
        if (this.win !== null && this.win.symbols !== null){
            this.win.symbols.forEach((ws) => { if (ws !== null)  ws.showAnim(false); });
        }
        if(this.winTimeoutID !== -1) clearTimeout(this.winTimeoutID);
    }
}

class LinesController{

    constructor (scene, controls, linesData, lineColor, reels, lineButtons)
    {
        this.scene = scene;   
        this.reels = reels; 
        if(linesData && linesData.length > 0) this.linesData = linesData; 
        else  this.linesData = this.getAllPossibleLines();
        this.lineColor = lineColor;
        this.lineButtons = lineButtons; // optional
        this.controls = controls;
        this.create();
    }

    create()
    {
        this.lines =[];
        for(var i = 0; i < this.linesData.length; i++)
        {
            var lineBehavior = new LineBehavior(this.scene, this, this.linesData[i], (this.lineButtons) ? this.lineButtons[i] : null, i + 1, this.lineColor);
            this.lines.push(lineBehavior);
        }    
        console.log('this.linesData : ' + this.linesData + '; length: ' + this.linesData.length);
    }

    setControlActivity(activity)
    {
        if(this.lineButtons) this.lineButtons.forEach((lb)=>{lb.interactable = activity;});
    }

    selectAllLines(show)
    {
        if (this.createAllPossibleLines && this.controls.selectedLinesCount > 0) return; //avoid max bet
        if (this.lines == null || this.lines.length == 0) return;
        if (this.controls != null) this.controls.setSelectedLinesCount(this.lines.length, show);
    }
 
    lineButton_Click(line)
    {
   
        var count = 1;
        if (line.isSelected)
        {
            count = line.number - 1;
        }
        else
        {
            count = line.number;
        }
        console.log('line: ' + line.number + '; count'+ count + '; iselected:' + line.isSelected);
        if (this.controls != null) this.controls.setSelectedLinesCount(count, true);
    }

    hideAllLines()
    {
        this.lines.forEach ((l)=> { l.lineFlashing(false); l.setLineVisible(false); });
    }

    changeSelectedLinesHandler(newCount, show)
    {
        newCount = Math.min(newCount, this.lines.length);
        for (var i = 0; i < this.lines.length; i++)
        {
            if (i < newCount)
            {
                if (!this.lines[i].isSelected)
                {
                    this.lines[i].select(show);
                }
            }
            else
            {
                if (this.lines[i].isSelected)
                {
                    this.lines[i].isSelected.deselect();
                }
            }
        }
    }

    getAllPossibleLines()
    {
        var maxCounterValues = [];
        this.reels.forEach((r)=>{maxCounterValues.push(r.windowsCount - 1);});
        var cC = new ComboCounter(maxCounterValues);
        var newLinesData = [];
        var i = 0;
        while (cC.nextCombo())
        {
            newLinesData.push([...cC.combo]);         
        }
        return newLinesData;
    }
}

class WinController
{
    constructor(scene, linesController, useScatter, scatter, jackpot, winShowTime)
    {
        this.scene = scene;
        this.linesController = linesController;
        this.scatter = scatter;
        this.useScatter = (useScatter && scatter !== null);
        this.jackpot = jackpot;
        this.useJackpot = (jackpot !== null);
        this.winShowTime = winShowTime;
        this.payTable = this.scene.payTableFull;
        this.scatterPayTable = this.scene.scatterPayTable;
        this.reels = this.scene.reels;
        this.scatterWin = null;
        this.jackpotWin = null;
        this.winLines = [];
        this.scatterWinSymbols = [];
        this.jackpotWinSymbols = [];
        this.winSeq = null;

    }

    // Return true if slot has any winning
    hasAnyWinn()
    {
        var hasLineWin = (this.winLines.length > 0);
        var hasScatterWin = (this.scatterWin !== null);
        var hasJpWin = (this.jackpotWin !== null);
        return (hasLineWin || hasScatterWin || hasJpWin);
    }

    searchWinSymbols()
    {
        console.log('search win symbols');
        this.winLines = [];
        this.linesController.lines.forEach((lB)=>{
            if (lB.isSelected)
            {
                lB.findWin(this.payTable);
                if(lB.win!=null) 
                {
                    this.winLines.push(lB);
                    console.log(lB.number + ' - line win: ' + lB.win);
                }
            }
        });

        // search scatters
        this.scatterWinSymbols = [];
        this.scatterWin = null;

        if (this.useScatter)
        {
            this.reels.forEach((reel)=>
            {
                var temp = reel.findWindowsSymbols(this.scatter);
                if(temp.length > 0) this.scatterWinSymbols.push(...temp);
            });


            this.scatterPayTable.forEach((sPL)=>
            {
                if (sPL.scattersCount > 0 && sPL.scattersCount == this.scatterWinSymbols.length)
                {
                    this.scatterWin = new WinData(this.scatterWinSymbols, sPL.freeSpins, sPL.pay);
                }
            });
            if (this.scatterWin == null) this.scatterWinSymbols = [];
        }

        // search jackpot
        this.jackpotWinSymbols = [];
        this.jackpotWin = null;
        console.log('use Jackpot: ' + this.useJackpot);
        if (this.useJackpot)
        {
            this.reels.forEach((reel)=>
            {
                var temp = reel.findWindowsSymbols(this.jackpot.symbolName);
                if(temp.length > 0) this.jackpotWinSymbols.push(...temp);
            });
            console.log('find Jackpot symbols: ' + this.jackpotWinSymbols.length);
            if (this.jackpot.symbolsCount > 0 && this.jackpot.symbolsCount  == this.jackpotWinSymbols.length)
            {
                this.jackpotWin = new WinData(this.jackpotWinSymbols, 0, this.scene.slotControls.jackpotAmount);
            }

            if (this.jackpotWin == null) this.jackpotWinSymbols = [];
        }
    }

    hasScatterWin()
    {
        return this.scatterWin != null;
    }

    hasJackpotWin()
    {
        return this.jackpotWin != null;
    }

    winSymbolShowOnce(completeCallBack)
    {
        if (this.winSeq != null) this.winSeq.break();
        this.winSeq = new SequencedActions();

        //show jackpot win 
        if (this.useJackpot && this.jackpotWinSymbols != null && this.jackpotWinSymbols.length > 0)
        {
            var pAj = new ParallelActions();
            this.jackpotWinSymbols.forEach((s)=>{

                pAj.add((callBack) =>
                {
                    s.showAnim(true); // s.showWinPrefab();
                    new SimpleTweenFloat(this, 0, 1, 3000, (p, dp) =>{ },  callBack); // just delay action
                });
            });

            this.winSeq.add((callBack) =>
            {
                pAj.start(() =>
                {
                    callBack();
                });
            });
        }


        //show linewins - all paylines at the same time
        var pA = new ParallelActions();
        this.winLines.forEach((l)=>
        {
            pA.add((callBack) =>
                    {
                        l.lineFlashing(true);
                        l.setLineVisible(true);

                        l.lineWinPlay(this.winShowTime,            // lineWinPlay time (symbols animation time)
                                (win) =>
                                {
                                    l.lineFlashing(false);
                                    l.setLineVisible(false);
                                    callBack();
                                });
                    });
        });

        this.winSeq.add((callBack) =>
        {
            pA.start(() =>
            {
                callBack();
            });
        });
         
        //show scatterwin
        if (this.useScatter && this.scatterWinSymbols != null && this.scatterWinSymbols.length > 0)
        {
            var pAs = new ParallelActions();
            this.scatterWinSymbols.forEach((s)=>{

                pAs.add((callBack) =>
                {
                    s.showAnim(true); // s.showWinPrefab();
                    new SimpleTweenFloat(this, 0, 1, 3000, (p, dp) =>{ },  callBack); // just delay action
                });
            });

            this.winSeq.add((callBack) =>
            {
                pAs.start(() =>
                {
                    callBack();
                });
            });
        }

        this.winSeq.add((callBack) =>
        {
            completeCallBack();
            callBack();
        });

        this.winSeq.start();
    }

    winShowCancel()
    {
        if(this.winSeq !== null)
        {
            this.winSeq.break();
        }

        if (this.winLines !== null)
        {
            this.winLines.forEach((lb)=>{lb.lineWinCancel();})
        }

        if( this.scatterWinSymbols !== null)
        {
            this.scatterWinSymbols.forEach((s)=>{s.showAnim(false);})
        }

        if( this.jackpotWinSymbols !== null)
        {
            this.jackpotWinSymbols.forEach((s)=>{s.showAnim(false);})
        }
        console.log('winShowCancel');
    }
    
    resetWin()
    {
        this.winLines.forEach((l)=>{ l.resetLineWinning();});
        this.scatterWinSymbols = null;
        this.scatterWin = null;
        this.jackpotWinSymbols = null;
        this.jackpotWin = null;
    }

    getLineWinCoins()
    {
        let res = 0;
        this.winLines.forEach((l)=>{res += l.win.pay; });
        return res;
    }

    getScatterWinCoins()
    {
        if (this.scatterWin !== null) return this.scatterWin.pay;
        return 0;
    }

    getJackpotWinCoins()
    {
        if (this.jackpotWin !== null) return this.jackpotWin.pay;
        return 0;
    }

    getWinSpins()
    {
        let res = 0;
        this.winLines.forEach((l)=>{ res += l.win.freeSpins; });  
        if (this.scatterWin !== null) res += this.scatterWin.freeSpins;
        return res;
    }
}

class PayLine
{
    constructor (scene, line, pay, freeSpins, wild)
    {
        this.scene = scene;
        this.line = line;
        this.pay = pay;
        this.freeSpins = freeSpins;
        this.useWildInFirstPosition = false;
        this.wild = wild;
    }

    getWildLines()
    {
        var res = [];
        if (!this.scene.useWild) return res; // return empty list

        var wPoss = this.getPositionsForWild();
        var maxWildsCount = (this.useWildInFirstPosition) ? wPoss.length - 1 : wPoss.length;
        var minWildsCount = 1;
        var maxCounterValues = [];
        wPoss.forEach((p)=>{maxCounterValues.push(1);});

        var cC = new ComboCounter(maxCounterValues);
        while (cC.nextCombo())
        {

            var combo = cC.combo;           
            var comboSum = cC.sum();     // count of wilds in combo
            
            if ((comboSum >= minWildsCount) && (comboSum <= maxWildsCount))
            {
                var p = new PayLine(this.scene, Array.from(this.line), this.pay, this.freeSpins, this.wild);
                for (var i = 0; i < wPoss.length; i++)
                {
                    var pos = wPoss[i];
                    if (combo[i] == 1)
                    {
                        p.line[pos] = this.wild;
                    }
                }

                if (!this.isEqual(p) && !this.containEqualLine(res, p)) res.push(p);
            }
        }
        return res;
    }

    getPositionsForWild()
    {
        var wPoss = [];
        var counter = 0;

        for (var i = 0; i < this.line.length; i++)
        {
            var sName = this.line[i];
            if (sName !== 'any' && sName !== this.wild) 
            {
                if (!this.useWildInFirstPosition && counter == 0) // don't use first
                {
                    counter++;
                }
                else
                {
                    if (this.scene.symbolsDict[sName].useWildSubstitute) wPoss.push(i); 
                        counter++;
                }
            }        
        }
        return wPoss;
    }

    isEqual(pLine)
    {
        if (pLine === null) return false;
        if (pLine.line === null) return false;
        if (this.line.length != pLine.line.length) return false;
        for (var i = 0; i < this.line.length; i++)
        {
            if (this.line[i] !== pLine.line[i]) return false;
        }
        return true;
    }

    containEqualLine(pList, pLine)
    {
        if (pList == null) return false;
        if (pLine == null) return false;
        if (pLine.line == null) return false;
        for(var i = 0 ; i < pList.length; i++)
        {
            if (pList[i].isEqual(pLine)) return true;
        }
        return false;
    }
}

class WinData
{
    constructor(symbols, freeSpins, pay)
    {
        this.symbols = symbols;
        this.freeSpins = freeSpins;
        this.pay = pay;
    }

    symbolsToString()
    {
        if (this.symbols == null) return "";
        var ss = "";
        this.symbols.forEach((item)=>{ss += (item !== null && item.sprite !== null) ? item.sprite.name : "?";});
        return ss;
    }

    toString()
    {
        return this.symbolsToString() + '\n' + 'Pay: ' + this.pay + '; FreeSpin: ' + this.freeSpins;
    }
}

class SlotPlayer{

    constructor(defaultCoins)
    {
        this.defaultCoins = defaultCoins;
        this.coins = this.defaultCoins;
        this.changeCoinsEvents = [];  
        this.winCoins = 0;
        this.changeWinCoinsEvents = [];
        this.level = 0;
        this.changeLevelEvents = [];
        this.levelProgress = 0;
        this.changeLevelProgressEvents = [];
        this.levelUpReward = 0;
        this.useLevelUpReward = false;
        this.loadCoins();
    }

    addCoins(count)
    {
        this.setCoinsCount(this.coins + count);
    }

    setCoinsCount(count)
    {
        count = Math.max(0, count);
        var changed = (this.coins != count);
        this.coins = count;
        if (changed) 
        {
            this.changeCoinsEvents.forEach((eW)=>{ if (eW!=null && eW.action!=null) eW.action.call(eW.context, this.coins); });
           // localStorage.setItem('mk_egypt_bl_amount', this.coins); // save coins
        }
    }

    loadCoins()
    {
        var amount = this.defaultCoins;
       // amount = parseInt(localStorage.getItem('mk_egypt_bl_amount')) || this.defaultCoins; // load https://www.dynetisgames.com/2018/10/28/how-save-load-player-progress-localstorage/
        this.setCoinsCount(amount);
    }

    addChangeCoinsEvent(event, context)
    {
        if(event != null) this.changeCoinsEvents.push(new EventWrapper(event, context));
    }

    addWinCoins(count)
    {
        this.setWinCoinsCount(this.winCoins + count);
    }

    setWinCoinsCount(count)
    {
        count = Math.max(0, count);
        var changed = (this.winCoins != count);
        this.winCoins = count;
        if (changed) 
        {
            this.changeWinCoinsEvents.forEach((eW)=>{ if (eW!=null && eW.action!=null) eW.action.call(eW.context, this.winCoins); });
        }
    }

    addWinCoinsChangeEvent(event, context)
    {
       if(event != null) this.changeWinCoinsEvents.push(new EventWrapper(event, context));
    }

    takeWin()
    {
        this.addCoins(this.winCoins);
        this.setWinCoinsCount(0);
    }

    addLevel(count)
    {
        this.setLevel(this.level + count);
    }

    setLevel(count)
    {
        count = Math.max(0, count);
        var changed = (this.level != count);
        var addLevels = count - this.level;
        this.level = count;
        if (changed) 
        {
            this.changeLevelEvents.forEach((eW)=>{ if (eW != null && eW.action!=null) eW.action.call(eW.context, this.level, Pahser.Math.Max(0, addLevels * this.levelUpReward), this.useLevelUpReward); });
        }
    }

    addChangeLevelEvent(event, context)
    {
        if(event != null) this.changeLevelEvents.push(new EventWrapper(event, context));
    }

    addLevelProgress(count)
    {
        this.setLevelProgress(this.levelProgress + count);
    }

    setLevelProgress(count, raiseEvent)
    {
        count = Math.max(0, count);
        if (count >= 100)
        {
            var addLevels = Math.floor(count / 100);
            this.addLevel(addLevels);
            count = 0;
        }

        var changed = (this.levelProgress != count);
        this.levelProgress = count;

        if (changed && raiseEvent)
        {
            this.changeLevelProgressEvents.forEach((eW)=>{ if (eW!=null && eW.action!=null) eW.action.call(eW.context, this.levelProgress); });
        } 
    }

    addChangeLevelProgressEvent(event, context)
    {
        if(event != null) this.changeLevelProgressEvents.push(new EventWrapper(event, context));
    }

    setDefaultData()
    {
        this.setCoinsCount(this.defaultCoins);       
        this.setLevel(0);
        this.setLevelProgress(0);
    }

    hasMoneyForBet (totalBet)
    {
        return totalBet <= this.coins; 
    }
}

class SlotControls
{
    constructor(scene, slotPlayer, linesData, lineColor, lineBetMaxValue, jackpotDefaultAmount)
    {
        this.slotPlayer = slotPlayer;
        this.scene = scene;
        this.linesController = new LinesController(this.scene, this, linesData, lineColor, this.scene.reels, this.scene.lineButtons);
        this.lines = this.linesController.lines;

        // default settings
        this.manualStop = false;                        // not allowed in current version
        this.holdToAutoSpin = false;                    // hold spin button pressed 2 sec to start auto spin mode
        this.maxLineBet = lineBetMaxValue;
        this.defaultLineBet = 1;
        this.autoPlayFreeSpins = true;
        this.jackpotDefaultAmount = jackpotDefaultAmount;

        // slot input parameters
        this.lineBet = 1;
        this.holdMultiplier = 1;
        this.selectedLinesCount = 0;
        this.freeSpins = 0;
        this.auto = false;
        this.autoSpinsCounter = 0;
        this.jackpotAmount = 0;

        // slot input controls
        this.hold = null;
        this.buttons = [];                  // all control buttons array

        // slot output controls
        this.freeSpinText = null;           // freeSpinText;
        this.spinText = null;               // spinText;
        this.autoSpinsCountText = null;     // autoSpinsCountText;
        
        // events
        this.changeTotalBetEvent = new MKEvent();
        this.changeLineBetEvent = new MKEvent();
        this.changeSelectedLinesEvent = new MKEvent();
        this.changeFreeSpinsEvent = new MKEvent();
        this.changeAutoSpinsCounterEvent = new MKEvent();
        this.changeAutoSpinModeEvent = new MKEvent();
        this.tryToSetAutoSpinModeEvent = new MKEvent();
        this.changeJackpotEvent = new MKEvent();

        // set event handlers
        this.changeFreeSpinsEvent.add(this.changeFreeSpinsHandler, this);
        this.changeTotalBetEvent.add(this.changeTotalBetHandler, this); 
        this.changeLineBetEvent.add(this.changeLineBetHandler, this); 
        this.changeSelectedLinesEvent.add(this.changeSelectedLinesHandler, this); 
        this.slotPlayer.addWinCoinsChangeEvent(this.changeWinCoinsHandler, this);
        this.slotPlayer.addChangeCoinsEvent(this.changeCreditCoinsHandler, this);
        this.changeJackpotEvent.add(this.changeJackpotHandler, this); 
    }

    init(selectLines, burn)
    {
        if (this.hold !== null) this.hold.changeBetMultiplierEvent.add((hm) => {this.refreshBetLines();}, this);
        this.changeAutoSpinsCounterEvent.add( (r, i) => {if (this.autoSpinsCountText != null) this.autoSpinsCountText.text = i;}, this);
        this.changeSelectedLinesEvent.add((l, b) => {if (this.infoText !== null) this.infoText.text = (l > 0) ? 'Click to SPIN to start!' : 'Select any slot line!';}, this);
        if(selectLines ==='all')
        {
            this.setSelectedLinesCount(this.lines.length, burn);
        }
        else
        {
            this.setSelectedLinesCount(1, burn);
        }
        this.loadJackpot();
        this.refresh();
    }

    isAnyLineSelected()
    {
        return (this.selectedLinesCount > 0);
    }

    hasFreeSpin()
    {
        return (this.freeSpins > 0); 
    }

    useHold()
    {
        return (this.hold !== null && this.hold.enabled); 
    }

    isReelsSpin()
    { 
        return this.slot !== null && this.slot.ReelsSpin; 
    }

    useManualStop() 
    {
      return  (this.manualStop && !this.auto);
    }

    setControlActivity(activity, spinButtonActivity, autoSpinButtonActivity)
    {
        console.log('setControlActivity(activity, spinButtonActivity, autoSpinButtonActivity): ' + activity + ',' + spinButtonActivity + ',' + autoSpinButtonActivity)
        if (this.menuController)  this.menuController.setControlActivity(activity);
        if (this.linesController) { this.linesController.setControlActivity(activity); }

        if (this.buttons != null)
        {
            this.buttons.forEach((b)=>{if (b) b.interactable = activity;});
        }

        if (this.slotSpinButton != null) this.slotSpinButton.setInteractable(spinButtonActivity);
        if (this.slotAutoSpinButton != null) this.slotAutoSpinButton.setInteractable(autoSpinButtonActivity);
    }

    refresh()
    {
        this.refreshBetLines();
        this.refreshSpins();
        if (this.winAmountText != null) this.winAmountText.text = 0;
    }

    refreshBetLines()
    {
        if (this.lineBetAmountText!= null) this.lineBetAmountText.text = this.lineBet;
        if (this.lineBetAmountText != null) this.totalBetSumText.text = this.getTotalBet();
        if (this.linesCountText != null) this.linesCountText.text = this.selectedLinesCount;
    }

    refreshSpins()
    {
        if (this.autoSpinsCountText != null) this.autoSpinsCountText.text = this.autoSpinCount;
        if (this.freeSpinText != null) this.freeSpinText.text = (this.freeSpins > 0) ? 'Free': '';
        if (this.freeSpinCountText != null) this.freeSpinCountText.text = (this.freeSpins > 0) ? this.freeSpins : '';
    }

    linesLoop_Click() // loop lines
    {
        if(this.linesController.lines.length <= this.selectedLinesCount)
        {
            this.setSelectedLinesCount(1, true);
        }
        else
        {
            this.addSelectedLinesCount(1, true);
        }
        this.scene.soundController.playClip('button_click');
    }

    linesPlus_Click()
    {
        this.addSelectedLinesCount(1, true);
        this.scene.soundController.playClip('button_click');
    }

    linesMinus_Click()
    {
        this.addSelectedLinesCount(-1, false);
        this.scene.soundController.playClip('button_click');
    }

    lineBetPlus_Click()
    {
        this.addLineBet(1);
        this.scene.soundController.playClip('button_click');
    }

    lineBetLoop_Click()
    {
       if(this.lineBet < this.maxLineBet)
       {
            this.addLineBet(1);
       }
       else{
            this.setLineBet(1);
       }   
       this.scene.soundController.playClip('button_click');
    }

    lineBetMinus_Click()
    {
        this.addLineBet(-1);
        this.scene.soundController.playClip('button_click');
    }

    autoSpinPlus_Click()
    {
        this.addAutoSpins(1);
        this.scene.soundController.playClip('button_click');
    }

    autoSpinMinus_Click()
    {
        this.addAutoSpins(-1);
        this.scene.soundController.playClip('button_click');
    }

    maxBet_Click()
    {
        this.linesController.selectAllLines(true);
        this.setMaxLineBet();
        this.scene.soundController.playClip('button_click');
    }

    changeFreeSpinsHandler(newFreeSpinsCount)
    {
        if (this.freeSpinText != null) this.freeSpinText.text = (this.freeSpins > 0) ? "Free" : "";
        if (this.freeSpinCountText != null) this.freeSpinCountText.text = (newFreeSpinsCount > 0) ? newFreeSpinsCount : "";
    }

    changeTotalBetHandler(newTotalBet)
    {
        if (this.totalBetSumText != null) this.totalBetSumText.text = newTotalBet;
    }

    changeLineBetHandler(newLineBet)
    {
        if (this.lineBetAmountText != null) this.lineBetAmountText.text = newLineBet;
    }

    changeSelectedLinesHandler(newCount, burn)
    {
        newCount = Math.min(newCount, this.lines.length);
        for (var i = 0; i < this.lines.length; i++)
        {
            if (i < newCount)
            {
                if (!this.lines[i].isSelected)
                {
                    this.lines[i].select(burn);
                }
            }
            else
            {
                if (this.lines[i].isSelected)
                {
                    this.lines[i].deselect();
                }
            }
        }
        if (this.linesCountText != null) this.linesCountText.text = newCount;

    }

    changeWinCoinsHandler(newCount)
    {
       if(this.winAmountText != null) this.winAmountText.text = newCount;
    }

    changeCreditCoinsHandler(newCount)
    {
       if(this.creditSumText != null) this.creditSumText.text = ' ' + newCount;
    }

    addLineBet(count)
    {
        this.setLineBet(this.lineBet + count);
    }

    setLineBet(count)
    {
        console.log('current line bet: ' + this.lineBet)
        count = Math.max(1, count);
        count = Math.min(count, this.maxLineBet);
        var changed = (this.lineBet != count);
        this.lineBet = count;
        console.log('set new line bet: ' + this.lineBet)
        if (changed)
        {
            this.changeLineBetEvent.events.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, this.lineBet); });
            this.changeTotalBetEvent.events.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, this.getTotalBet()); });
        }
    }

    setMaxLineBet()
    {
        this.setLineBet(this.maxLineBet);
    }

    applyBet()
    {
        if (this.slotPlayer.hasMoneyForBet(this.getTotalBet()))
        {
            this.slotPlayer.addCoins(-this.getTotalBet());
            return true;
        }
        else
        {
            return false;
        }
    }

    addSelectedLinesCount(count, burn)
    {
        this.setSelectedLinesCount(this.selectedLinesCount + count, burn);
    }

    setSelectedLinesCount(count, burn)
    {
        count = Math.max(1, count);
        count = Math.min(this.linesController.lines.length, count);
        var changed = (this.selectedLinesCount != count);
        this.selectedLinesCount = count;
        if (changed)
        {
            this.changeSelectedLinesEvent.events.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, count, burn); });
            this.changeTotalBetEvent.events.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, this.getTotalBet()); });
        }
        console.log('selectedLinesCount: '+ this.selectedLinesCount);
    }

    addFreeSpins(count)
    {
        this.setFreeSpinsCount(this.freeSpins + count);
    }

    setFreeSpinsCount(count)
    {
        count = Math.max(0, count);
        var changed = (this.freeSpins != count);
        this.freeSpins = count;
        if (changed) this.changeFreeSpinsEvent.events.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, this.freeSpins);});
    }

    loadFreeSpins()
    {
        this.setFreeSpinsCount(0);
    }

    applyFreeSpin()
    {
        if (this.hasFreeSpin)
        {
            this.addFreeSpins(-1);
            return true;
        }
        else
        {
            return false;
        }
    }

    incAutoSpinsCounter()
    {
        this.setAutoSpinsCounter(this.autoSpinsCounter + 1);
    }

    setAutoSpinsCounter(count)
    {
        count = Math.max(0, count);
        var changed = (count != this.autoSpinsCounter);
        this.autoSpinsCounter = count;
        if (changed) this.changeAutoSpinsCounterEvent.events.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, this.autoSpinsCounter, this.autoSpinCount); });
    }

    resetAutoSpinsMode()
    {
        this.auto = false;
        this.changeAutoSpinModeEvent.events.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, false);});
    }

    setAutoSpinsMode()
    {
        this.setAutoSpinsCounter(0);
        this.auto = true;
        this.changeAutoSpinModeEvent.events.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, true);});
    }

    setDefaultData()
    {
        this.setLineBet(this.defaultLineBet);
    }

    setSpinButtonText(text)
    {
        if(this.spinText != null) this.spinText.text = text;
    }

    getTotalBet()
    {
        return this.selectedLinesCount * this.lineBet * this.holdMultiplier;
    }

    /*Jackpot */
    setJackpotAmount(amount)
    {
        amount = Math.max(0, amount);
        var changed = (this.jackpotAmount != amount);
        this.jackpotAmount = amount;
        if (changed) 
        {
            this.changeJackpotEvent.events.forEach((eW)=>{ if (eW != null && eW.action != null) eW.action.call(eW.context, this.jackpotAmount);});
          //  localStorage.setItem('mk_egypt_jp_amount', this.jackpotAmount); // save https://www.dynetisgames.com/2018/10/28/how-save-load-player-progress-localstorage/
        }
    }

    addJackpotAmount(amount)
    {
        this.setJackpotAmount(this.jackpotAmount + amount);
    }

    loadJackpot()
    {
        var amount = this.jackpotDefaultAmount;
      //  amount = parseInt(localStorage.getItem('mk_egypt_jp_amount')) || this.jackpotDefaultAmount; // load https://www.dynetisgames.com/2018/10/28/how-save-load-player-progress-localstorage/
        this.setJackpotAmount(amount);
    }

    resetJackpot()
    {
        this.setJackpotAmount(this.jackpotDefaultAmount);
    }

    changeJackpotHandler(newAmount)
    {
        if (this.jackpotAmountText != null) this.jackpotAmountText.text = newAmount;
    }   
}