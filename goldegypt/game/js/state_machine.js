// v1.0 08.01.2024
class PreSpinState
{
    constructor(scene, stateMachine)
    {
        this.stateMachine = stateMachine;
        this.stateObject = scene;
        this.slotControls = scene.slotControls;
        this.spinButton = this.slotControls.slotSpinButton;
        this.autoSpinButton = this.slotControls.slotAutoSpinButton;
        this.guiController;
        this.slotPlayer = scene.slotPlayer;;
        this.subState = null;
    }

    enterFrom(oldState)
    {
        console.log(this.toString() + ' - Enter From: ' + oldState.toString());

        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.add(this.longPressSpin_Click, this);
            this.spinButton.clickEvent.add(this.spin_Click, this);
            this.spinButton.pointerDownEvent.add(this.spin_PointerDown, this);
            this.spinButton.longPointerDownEvent.add(this.spin_LongPointerDown, this);
        }

        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.add(this.autoSpin_Click, this);
        }

        this.slotControls.setControlActivity(false, false, false);      // activity, spinButtonAcivity, autoSpinButtonAcivity
        this.stateObject.winController.winShowCancel();
        this.stateObject.winController.resetWin();
        this.stateObject.isFreeSpin = false;

        if(this.stateObject.isCascadeSpin) // first cascade spin
        {
            this.stateMachine.changeState(this.stateObject.spinState);
            return;
        }

        if (!this.slotControls.isAnyLineSelected())
        {
            var mess = this.stateObject.guiController.showMessage('', 'Please select a any line.', this, ()=>{this.stateObject.guiController.closePopUp(mess);});
            this.stateMachine.changeState(this.stateObject.iddleState);
            return;
        }

        if (this.slotControls.getTotalBet() > this.slotPlayer.coins)
        {
            var mess = this.stateObject.guiController.showMessage('Sorry!', 'You have no money.', this, ()=>{this.stateObject.guiController.closePopUp(mess);});
            if(this.slotControls.auto) this.slotControls.resetAutoSpinsMode();
            this.stateMachine.changeState(this.stateObject.iddleState);
            return;
        }

        console.log(this.toString() + '  - go to spin state');

        this.stateMachine.changeState(this.stateObject.spinState);
    }

    exitTo(newState)
    {
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.remove(this.longPressSpin_Click);
            this.spinButton.clickEvent.remove(this.spin_Click);
            this.spinButton.pointerDownEvent.remove(this.spin_PointerDown);
            this.spinButton.longPointerDownEvent.remove(this.spin_LongPointerDown);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.remove(this.autoSpin_Click);
        }
    }

    //region input
    spin_PointerDown()
    {

    }

    spin_LongPointerDown()
    {

    }

    longPressSpin_Click()
    {
          
    }

    spin_Click()
    {

    }

    autoSpin_Click()
    {

    }
    //endregion input

    //region old
    handleInput()
    {
      //  handleInput();
    }

    physicsUpdate()
    {

    }
    //endregion old

    toString()
    {
        return 'PreSpinState';
    }
}

class SpinState
{
    constructor(scene, stateMachine)
    {
        this.stateMachine = stateMachine;
        this.stateObject = scene;
        this.slotControls = scene.slotControls;
        this.normalSpinState = new NormalSpinState(scene, stateMachine);
        this.freeSpinState = new FreeSpinState(scene, stateMachine);
        this.autoSpinState = new AutoSpinState(scene, stateMachine);
        this.endLessSpinState = new EndLessSpinState(scene, stateMachine);
        this.cascadeSpinState = new CascadeSpinState(scene, stateMachine);
        this.subState = null;
    }

     enterFrom(oldState)
     {
        console.log(this.toString() + ' - Enter From: ' + oldState.toString());
        if (this.stateObject.isCascadeSpin) this.subState = this.cascadeSpinState; // first cascade spins
        else if (this.slotControls.hasFreeSpin()) this.subState = this.freeSpinState;
        else if (this.slotControls.auto) this.subState = this.autoSpinState;
        else if (this.slotControls.useManualStop()) this.subState = this.endLessSpinState;
        else this.subState = this.normalSpinState;
        console.log('Spin Substate: ' +  this.subState.toString());
        this.subState.enterFrom(oldState);
     }

     exitTo(newState)
     {
        this.subState.exitTo(newState);
        this.subState = null;
     }

     //region old
     handleInput()
     {
    
     }

     physicsUpdate()
     {
   
     }
     //endregion old

     toString()
     {
         return (this.subState !== null) ? this.subState.toString() : 'SpinState';
     }
}

class AutoSpinState
{

    constructor(scene,  stateMachine)
     {
        this.stateMachine = stateMachine;
        this.stateObject = scene;
        this.slotControls = scene.slotControls;
        this.spinButton = this.slotControls.slotSpinButton;
        this.autoSpinButton = this.slotControls.slotAutoSpinButton;
     }

     enterFrom(oldState)
     {
        console.log(this.toString() + " - Enter From: " + oldState.toString());

        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.add(this.longPressSpin_Click, this);
            this.spinButton.clickEvent.add(this.spin_Click, this);
            this.spinButton.pointerDownEvent.add(this.spin_PointerDown, this);
            this.spinButton.longPointerDownEvent.add(this.spin_LongPointerDown, this);
        }

        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.add(this.autoSpin_Click, this);
        }

        this.slotControls.setSpinButtonText("SPIN");
        this.slotControls.setControlActivity(false, true, true);
        console.log(this.toString() + " - run auto spin");
        this.slotControls.applyBet();
        this.stateObject.runSlot();
     }

    exitTo(newState)
    {
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.remove(this.longPressSpin_Click);
            this.spinButton.clickEvent.remove(this.spin_Click);
            this.spinButton.pointerDownEvent.remove(this.spin_PointerDown);
            this.spinButton.longPointerDownEvent.remove(this.spin_LongPointerDown);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.remove(this.autoSpin_Click);
        }
    }

     //region input
    spin_PointerDown()
    {
    }

    spin_LongPointerDown()
    {
    }

    longPressSpin_Click()
    {
        this.slotControls.resetAutoSpinsMode();
        this.slotControls.setControlActivity(false, false, false);      // activity, spinButtonAcivity, autoSpinButtonAcivity
    }

    spin_Click()
    {
        this.slotControls.resetAutoSpinsMode();
        this.slotControls.setControlActivity(false, false, false);      // activity, spinButtonAcivity, autoSpinButtonAcivity
    }

    autoSpin_Click()
    {
        this.slotControls.resetAutoSpinsMode();
        this.slotControls.setControlActivity(false, false, false);      // activity, spinButtonAcivity, autoSpinButtonAcivity
    }
    //endregion input

    //region old
    handleInput()
    {
    }

    physicsUpdate()
    {
    }
    //endregion old

    toString()
    {
        return "AutoSpinState";
    }
 }

class NormalSpinState
{
    constructor(scene, stateMachine)
    {
        this.stateMachine = stateMachine;
        this.stateObject = scene;
        this.slotControls = scene.slotControls;
        this.spinButton = this.slotControls.slotSpinButton;
        this.autoSpinButton = this.slotControls.slotAutoSpinButton;
        this.guiController;
        this.subState = null;

    }

    enterFrom(oldState)
    {
        console.log(this.toString() + ' - Enter From: ' + oldState.toString());
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.add(this.longPressSpin_Click);
            this.spinButton.clickEvent.add(this.spin_Click);
            this.spinButton.pointerDownEvent.add(this.spin_PointerDown);
            this.spinButton.longPointerDownEvent.add(this.spin_LongPointerDown);
        }

        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.add(this.autoSpin_Click);
        }

        this.slotControls.setSpinButtonText('SPIN');
        this.slotControls.setControlActivity(false, false,false);       // activity, spinButtonAcivity, autoSpinButtonAcivity
        console.log(this.toString() + '  - run normal spin');
        this.slotControls.applyBet();
        this.stateObject.runSlot();
    }

    exitTo(newState)
    {
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.remove(this.longPressSpin_Click);
            this.spinButton.clickEvent.remove(this.spin_Click);
            this.spinButton.pointerDownEvent.remove(this.spin_PointerDown);
            this.spinButton.longPointerDownEvent.remove(this.spin_LongPointerDown);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.remove(this.autoSpin_Click);
        }
    }

    // region input
    spin_PointerDown()
    {

    }

    spin_LongPointerDown()
    {

    }

    longPressSpin_Click()
    {
          
    }

    spin_Click()
    {

    }

    autoSpin_Click()
    {

    }
    //endregion input


    //region old
    handleInput()
    {

    }

    physicsUpdate()
    {

    }
    //endregion old

    toString()
    {
        return 'NormalSpinState';
    }

    calcWinHandler(win)
    {
        if (win) this.stateMachine.changeState(this.stateObject.winState);  else this.stateMachine.changeState(this.stateObject.looseState); 
    }
}

class IddleState
{
    constructor(scene, stateMachine) 
    {
        this.stateMachine = stateMachine;
        this.stateObject = scene;
        this.slotControls = scene.slotControls;
        this.spinButton = this.slotControls.slotSpinButton;
        this.autoSpinButton = this.slotControls.slotAutoSpinButton;
    }

    enterFrom(oldState)
    {
        console.log(this.toString() + ' - enter from: ' + ((oldState === null) ? 'null' : oldState.toString()));
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.add(this.longPressSpin_Click, this);
            this.spinButton.clickEvent.add(this.spin_Click, this);
            this.spinButton.pointerDownEvent.add(this.spin_PointerDown, this);
            this.spinButton.longPointerDownEvent.add(this.spin_LongPointerDown, this);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.add(this.autoSpin_Click, this);
        }

        this.slotControls.setControlActivity(true, true, true);     // activity, spinButtonAcivity, autoSpinButtonAcivity
        this.slotControls.setSpinButtonText('SPIN');
    }

    exitTo(newState)
    {
        console.log(this.toString() + ' - Exit To: ' + newState.toString());
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.remove(this.longPressSpin_Click);
            this.spinButton.clickEvent.remove(this.spin_Click);
            this.spinButton.pointerDownEvent.remove(this.spin_PointerDown);
            this.spinButton.longPointerDownEvent.remove(this.spin_LongPointerDown);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.remove(this.autoSpin_Click);
        }
    }

    //region input
    spin_PointerDown()
    {
    }

    spin_LongPointerDown()
    {
    }

    longPressSpin_Click()
    {
        if (this.slotControls.holdToAutoSpin)
        {
            this.slotControls.setAutoSpinsMode();
        }
        this.stateMachine.changeState(this.stateObject.preSpinState);
    }

    spin_Click()
    {
        console.log(this.toString() + " - Spin Click");
        this.stateMachine.changeState(this.stateObject.preSpinState);
    }

    autoSpin_Click()
    {
        console.log(this.toString() + " - Auto Spin Click");
        this.slotControls.setAutoSpinsMode();
        this.stateMachine.changeState(this.stateObject.preSpinState);
    }
    //endregion input

    //region old
    handleInput()
    {
    }

    physicsUpdate()
    {
    }
    //endregion old

    toString()
    {
        return 'IddleState';
    }
}

class FreeSpinState 
{
    constructor(scene, stateMachine)
    {
        this.stateMachine = stateMachine;
        this.stateObject = scene;
        this.slotControls = scene.slotControls;
        this.spinButton = this.slotControls.slotSpinButton;
        this.autoSpinButton = this.slotControls.slotAutoSpinButton;
    }

    enterFrom(oldState)
    {
        console.log(this.toString() + " - Enter From: " + oldState.toString());
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.add(this.longPressSpin_Click, this);
            this.spinButton.clickEvent.add(this.spin_Click, this);
            this.spinButton.pointerDownEvent.add(this.spin_PointerDown, this);
            this.spinButton.longPointerDownEvent.add(this.spin_LongPointerDown, this);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.add(this.autoSpin_Click, this);
        }
        this.slotControls.setControlActivity(false, this.slotControls.auto, this.slotControls.auto);      // activity, spinButtonAcivity, autoSpinButtonAcivity
        console.log(this.toString() + "  - run free spin");
        this.stateObject.isFreeSpin = true;
        this.slotControls.applyFreeSpin();
        this.stateObject.runSlot();
        this.slotControls.setSpinButtonText(this.slotControls.freeSpins.toString());
    }

    exitTo(newState)
    {
        console.log(this.toString() + " - Exit To: " + newState.toString());
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.remove(this.longPressSpin_Click);
            this.spinButton.clickEvent.remove(this.spin_Click);
            this.spinButton.pointerDownEvent.remove(this.spin_PointerDown);
            this.spinButton.longPointerDownEvent.remove(this.spin_LongPointerDown);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.remove(this.autoSpin_Click);
        }
    }

    //region input
    spin_PointerDown()
    {
    }

    spin_LongPointerDown()
    {
    }

    longPressSpin_Click()
    {
        this.slotControls.resetAutoSpinsMode();
        // and diisable input
        this.slotControls.setControlActivity(false, false, false);      // activity, spinButtonAcivity, autoSpinButtonAcivity
    }

    spin_Click()
    {
        this.slotControls.resetAutoSpinsMode();
        // and diisable input
        this.slotControls.setControlActivity(false, false, false);      // activity, spinButtonAcivity, autoSpinButtonAcivity
    }

    autoSpin_Click()
    {
        this.slotControls.resetAutoSpinsMode();
        // and diisable input
        this.slotControls.setControlActivity(false, false, false);      // activity, spinButtonAcivity, autoSpinButtonAcivity
    }
    //endregion input

    //region old
    handleInput()
    {
    }

    physicsUpdate()
    {
    }
    //endregion old

    toString()
    {
        return "FreeSpinState";
    }
}

// not used in this version
class EndLessSpinState
{
    constructor(scene, stateMachine)
    {
        this.stateMachine = stateMachine;
        this.stateObject = scene;
        this.slotControls = scene.slotControls;
        this.spinButton = this.slotControls.slotSpinButton;
        this.autoSpinButton = this.slotControls.slotAutoSpinButton;
    }

    enterFrom(oldState)
    {
        console.log(this.toString() + " - Enter From: " + oldState.toString());
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.add(this.longPressSpin_Click, this);
            this.spinButton.clickEvent.add(this.spin_Click, this);
            this.spinButton.pointerDownEvent.add(this.spin_PointerDown, this);
            this.spinButton.longPointerDownEvent.add(this.spin_LongPointerDown, this);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.add(this.autoSpin_Click, this);
        }
        this.slotControls.setSpinButtonText("STOP");
        this.slotControls.setControlActivity(false, true, false);       // activity, spinButtonAcivity, autoSpinButtonAcivity

        console.log(this.toString() + "  - run endless spin");
        this.slotControls.applyBet();
        this.stateObject.runSlotEndLess();
    }

    exitTo(newState)
    {
        console.log(this.toString() + " - Exit To: " + newState.toString());
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.remove(this.longPressSpin_Click);
            this.spinButton.clickEvent.remove(this.spin_Click);
            this.spinButton.pointerDownEvent.remove(this.spin_PointerDown);
            this.spinButton.longPointerDownEvent.remove(this.spin_LongPointerDown);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.remove(this.autoSpin_Click);
        }
    }

    //region input
    spin_PointerDown()
    {
    }

    spin_LongPointerDown()
    {
    }

    longPressSpin_Click()
    {
        this.stateObject.stopSlot();
        this.slotControls.setControlActivity(false, false, false);      // activity, spinButtonAcivity, autoSpinButtonAcivity
        this.slotControls.setSpinButtonText("SPIN");
    }

    spin_Click()
    {
        this.stateObject.stopSlot();
        this.slotControls.setControlActivity(false, false, false);      // activity, spinButtonAcivity, autoSpinButtonAcivity
        this.slotControls.setSpinButtonText("SPIN");
    }

    autoSpin_Click()
    {       
    }
    //endregion input

    //region old
    handleInput()
    {
    }

    physicsUpdate()
    {
    }
    //endregion old

    toString()
    {
        return "EndlessSpinState";
    }
}

// not used in this version
class CascadeSpinState
{
    constructor(scene, stateMachine)
    {
        this.stateMachine = stateMachine;
        this.stateObject = scene;
        this.slotControls = scene.slotControls;
        this.spinButton = this.slotControls.slotSpinButton;
        this.autoSpinButton = this.slotControls.slotAutoSpinButton;
        this.guiController;
    }

    enterFrom(oldState)
    {
        console.log(this.toString() + " - Enter From: " + oldState.toString());
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.add(this.longPressSpin_Click, this);
            this.spinButton.clickEvent.add(this.spin_Click, this);
            this.spinButton.pointerDownEvent.add(this.spin_PointerDown, this);
            this.spinButton.longPointerDownEvent.add(this.spin_LongPointerDown, this);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.add(this.autoSpin_Click, this);
        }

        this.slotControls.setSpinButtonText("SPIN");
        this.slotControls.setControlActivity(false, false, false);  // activity, spinButtonAcivity, autoSpinButtonAcivity
        console.log(this.toString() + "  - run cascade spin");
        this.stateObject.runCascadeSpin();  // run cascade spin
    }

    exitTo(newState)
    {
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.remove(this.longPressSpin_Click);
            this.spinButton.clickEvent.remove(this.spin_Click);
            this.spinButton.pointerDownEvent.remove(this.spin_PointerDown);
            this.spinButton.longPointerDownEvent.remove(this.spin_LongPointerDown);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.remove(this.autoSpin_Click);
        }
    }

    //region input
    spin_PointerDown()
    {
    }

    spin_LongPointerDown()
    {
    }

    longPressSpin_Click()
    {        
    }

    spin_Click()
    {
    }

    autoSpin_Click()
    {
    }
    //endregion input

    //region old
    handleInput()
    {
    }

    physicsUpdate()
    {
    }
    //endregion old

    toString()
    {
        return "CascadeSpinState";
    }
}

class WinState 
{
    constructor(scene, stateMachine)
    {
        this.stateMachine = stateMachine;
        this.stateObject = scene;
        this.slotControls = scene.slotControls;
        this.spinButton = this.slotControls.slotSpinButton;
        this.autoSpinButton = this.slotControls.slotAutoSpinButton;
    }

    enterFrom(oldState)
    {
        console.log(this.toString() + " - Enter From: " + oldState.toString());
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.add(this.longPressSpin_Click, this);
            this.spinButton.clickEvent.add(this.spin_Click, this);
            this.spinButton.pointerDownEvent.add(this.spin_PointerDown, this);
            this.spinButton.longPointerDownEvent.add(this.spin_LongPointerDown, this);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.add(this.autoSpin_Click, this);
        }
        this.slotControls.setSpinButtonText(this.slotControls.freeSpins > 0 ? this.slotControls.freeSpins : "SPIN");

        // control activity
        this.slotControls.setControlActivity(false, this.slotControls.auto, this.slotControls.auto);                                 // activity, spinButtonAcivity, autoSpinButtonAcivity
        if(this.stateObject.isCascadeSpin) this.stateObject.winShow(() => {this.stateMachine.changeState(this.stateObject.preSpinState);});            // winshow -> prespin state -> cascade spin
        else this.stateObject.winShow(() => {this.stateMachine.changeState(this.stateObject.freeInputWinState);});
    }

    exitTo(newState)
    {
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.remove(this.longPressSpin_Click);
            this.spinButton.clickEvent.remove(this.spin_Click);
            this.spinButton.pointerDownEvent.remove(this.spin_PointerDown);
            this.spinButton.longPointerDownEvent.remove(this.spin_LongPointerDown);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.remove(this.autoSpin_Click);
        }
    }

    //region input
    spin_PointerDown()
    {
    }

    spin_LongPointerDown()
    {
    }

    longPressSpin_Click()
    {
        if (this.slotControls.auto)
        {
            this.slotControls.resetAutoSpinsMode();
            this.slotControls.setControlActivity(false, this.slotControls.auto, false); // activity, spinButtonAcivity, autoSpinButtonAcivity
            return;
        }
    }

    spin_Click()
    {
        if (this.slotControls.auto)
        {
            this.slotControls.resetAutoSpinsMode();
            this.slotControls.setControlActivity(false, this.slotControls.auto, false); // activity, spinButtonAcivity, autoSpinButtonAcivity
            return;
        }
    }

    autoSpin_Click()
    {
        if (this.slotControls.auto)
        {
            this.slotControls.resetAutoSpinsMode();
            this.slotControls.setControlActivity(false, this.slotControls.auto, false);      // activity, spinButtonAcivity, autoSpinButtonAcivity
            return;
        }
    }
    //endregion input

    //region old
    handleInput()
    {
    }

    physicsUpdate()
    {
    }
    //endregion old

    toString()
    {
        return "WinState";
    }
}

class LoseState
{
    constructor(scene, stateMachine)
    {
        this.stateMachine = stateMachine;
        this.stateObject = scene;
        this.slotControls = scene.slotControls;
        this.spinButton = this.slotControls.slotSpinButton;
        this.autoSpinButton = this.slotControls.slotAutoSpinButton;
        this.guiController;
        this.slotPlayer = scene.slotPlayer;;
    }

    enterFrom(oldState)
    {
        console.log(this.toString() + ' - Enter From: ' + oldState.toString());

        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.add(this.longPressSpin_Click, this);
            this.spinButton.clickEvent.add(this.spin_Click, this);
            this.spinButton.pointerDownEvent.add(this.spin_PointerDown, this);
            this.spinButton.longPointerDownEvent.add(this.spin_LongPointerDown, this);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.add(this.autoSpin_Click, this);
        }

        this.slotControls.setSpinButtonText(this.slotControls.freeSpins > 0 ? this.slotControls.freeSpins : 'SPIN');

        this.setInputActivity();
        this.stateObject.loseShow((needSpin) =>
        {
            if (needSpin) this.stateMachine.changeState(this.stateObject.preSpinState);
            else
            {
            }
        });
    }

    exitTo(newState)
    {
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.remove(this.longPressSpin_Click);
            this.spinButton.clickEvent.remove(this.spin_Click);
            this.spinButton.pointerDownEvent.remove(this.spin_PointerDown);
            this.spinButton.longPointerDownEvent.remove(this.spin_LongPointerDown);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.remove(this.autoSpin_Click);
        }
    }

    //region input
    spin_PointerDown()
    {
    }

    spin_LongPointerDown()
    {
    }

    longPressSpin_Click()
    {
        if (this.slotControls.auto)
        {
            this.slotControls.resetAutoSpinsMode();
            this.setInputActivity();
        }
        else if (this.slotControls.holdToAutoSpin)
        {
            this.slotControls.setAutoSpinsMode();
            this.stateMachine.changeState(this.stateObject.preSpinState);
        }
    }

    spin_Click()
    {
        if (this.slotControls.auto)
        {
            this.slotControls.resetAutoSpinsMode();
            this.setInputActivity();
        }
        else
        {
            this.stateMachine.changeState(this.stateObject.preSpinState);
        }
    }

    autoSpin_Click()
    {
        if (this.slotControls.auto)
        {
            this.slotControls.resetAutoSpinsMode();
            this.setInputActivity();
        }
        else
        {
            this.slotControls.setAutoSpinsMode();
            this.stateMachine.changeState(this.stateObject.preSpinState);
        }
    }
    //endregion input

    setInputActivity()
    {
        if (this.slotControls.hasFreeSpin() && this.slotControls.autoPlayFreeSpins) this.slotControls.setControlActivity(false, false, false);        // activity, spinButtonAcivity, autoSpinButtonAcivity
        else if (this.slotControls.hasFreeSpin() && !this.slotControls.autoPlayFreeSpins) this.slotControls.setControlActivity(false, true, false);   // activity, spinButtonAcivity, autoSpinButtonAcivity
        else if (this.slotControls.auto)
        {
            this.slotControls.setControlActivity(false, true, true);    // activity, spinButtonAcivity, autoSpinButtonAcivity
        }
        else this.slotControls.setControlActivity(true, true, true);     // activity, spinButtonAcivity, autoSpinButtonAcivity
    }

    //region old
    handleInput()
    {
    }

    physicsUpdate()
    {
    }
    //endregion old

    toString()
    {
        return 'LooseState';
    }
}

class FreeInputWinState
{
    constructor(scene, stateMachine)
    {
        this.stateMachine = stateMachine;
        this.stateObject = scene;
        this.slotControls = scene.slotControls;
        this.spinButton = this.slotControls.slotSpinButton;
        this.autoSpinButton = this.slotControls.slotAutoSpinButton;
    }

    enterFrom(oldState)
    {
        console.log(this.toString() + ' - Enter From: ' + oldState.toString());

        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.add(this.longPressSpin_Click, this);
            this.spinButton.clickEvent.add(this.spin_Click, this);
            this.spinButton.pointerDownEvent.add(this.spin_PointerDown, this);
            this.spinButton.longPointerDownEvent.add(this.spin_LongPointerDown, this);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.add(this.autoSpin_Click, this);
        }

        this.slotControls.setSpinButtonText(this.slotControls.freeSpins > 0 ? this.slotControls.freeSpins : 'SPIN');
        this.setInputActivity();
        this.stateObject.freeInputWinShow((needSpin)=> { if (needSpin) this.stateMachine.changeState(this.stateObject.preSpinState); });
    }

    exitTo(newState)
    {
        if (this.spinButton !== null)
        {
            this.spinButton.longPressClickEvent.remove(this.longPressSpin_Click);
            this.spinButton.clickEvent.remove(this.spin_Click);
            this.spinButton.pointerDownEvent.remove(this.spin_PointerDown);
            this.spinButton.longPointerDownEvent.remove(this.spin_LongPointerDown);
        }
        if (this.autoSpinButton !== null)
        {
            this.autoSpinButton.clickEvent.remove(this.autoSpin_Click);
        }
    }

    //region input
    spin_PointerDown()
    {
    }

    spin_LongPointerDown()
    {
    }

    longPressSpin_Click()
    {
        if (this.slotControls.auto)
        {
            this.slotControls.resetAutoSpinsMode();
            this.setInputActivity();
        }
        else if (this.slotControls.holdToAutoSpin)
        {
            this.slotControls.setAutoSpinsMode();
            this.stateMachine.changeState(this.stateObject.preSpinState);
        }
    }

    spin_Click()
    {
        if (this.slotControls.auto)
        {
            this.slotControls.resetAutoSpinsMode();
            this.setInputActivity();
        }
        else
        {
            this.stateMachine.changeState(this.stateObject.preSpinState);
        }
    }

    autoSpin_Click()
    {
        if (this.slotControls.auto)
        {
            this.slotControls.resetAutoSpinsMode();
            this.setInputActivity();
        }
        else
        {
            this.slotControls.setAutoSpinsMode();
            this.stateMachine.changeState(this.stateObject.preSpinState);
        }
    }
    //endregion input

    setInputActivity()
    {
        if (this.slotControls.hasFreeSpin() && this.slotControls.autoPlayFreeSpins) this.slotControls.setControlActivity(false, false, false);        // activity, spinButtonAcivity, autoSpinButtonAcivity
        else if (this.slotControls.hasFreeSpin() && !this.slotControls.autoPlayFreeSpins) this.slotControls.setControlActivity(false, true, false);   // activity, spinButtonAcivity, autoSpinButtonAcivity
        else if (this.slotControls.auto)
        {
            this.slotControls.setControlActivity(false, true, true);    // activity, spinButtonAcivity, autoSpinButtonAcivity
        }
        else this.slotControls.setControlActivity(true, true, true);     // activity, spinButtonAcivity, autoSpinButtonAcivity
    }

    //region old
    handleInput()
    {
    }

    physicsUpdate()
    {
    }
    //endregion old

    toString()
    {
        return 'FreeInputWinState';
    }
}

class SpinButton
{
    constructor (scene, spriteNormal, spriteHover, isSwitch)
    {
        this.spriteNormal = spriteNormal;
        this.spriteHover = spriteHover;
        this.scene = scene;
        this.slotControls = scene.slotControls;
        this.clickEvent = new MKEvent();
        this.longPressClickEvent = new MKEvent();
        this.pointerDownEvent = new MKEvent();
        this.longPointerDownEvent = new MKEvent();;
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
        this.button.on('pointerdown', this.pointerDown,this);
        this.button.on('pointerup', this.pointerUp,this);
        this.button.on('pointerover', this.pointerOver,this);
        this.button.on('pointerout', this.pointerOut,this);
        this.button.setInteractive();
        this.interactable = true;
        this.pressed = false;
        this.pDown = false;
        this.up = true;
        //this.downTime = 0;
        this.longPressTime = 2000; // miliseconds
        this.longPress = false;
        this.timeoutID = -1;
    }

    pointerUp() 
    {
        if(this.timeoutID !== -1) clearTimeout(this.timeoutID);             // remove timer if exist
        this.up = true;
    
        if(!this.pDown) return;
        this.pDown = false;     // reset pdown

        if(!this.interactable) return;
        if(!this.isSwitch) this.pressed = false;     

        this.button.setTexture( this.pressed ? this.spriteHover : this.spriteNormal);
        if (this.longPress)
        {
            this.longPress = false;
            this.longPressClickEvent.invoke();
        }
        else
        {
            this.clickEvent.invoke();
        }
    }

    pointerDown() 
    {  
        if(this.timeoutID !== -1) clearTimeout(this.timeoutID);         // remove timer 
        this.longPress = false;
        this.up = false;
        this.pDown = true;
        if(!this.interactable) return;
        if(this.isSwitch) this.pressed = !this.pressed;  
        this.button.setTexture(this.spriteHover); //         console.log('button down', arguments);
        this.pointerDownEvent.invoke();      

        this.timeoutID = setTimeout(() => {
            this.longPress = true;
            this.longPointerDownEvent.invoke();
          },  this.longPressTime);
    }

    pointerOver() 
    {
        if(!this.interactable) return;
       // this.button.setTexture(this.spriteHover);
    }

    pointerOut() 
    {   
        if(this.timeoutID !== -1) clearTimeout(this.timeoutID);         // remove timer
        if(!this.interactable) return;
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

    setSpinModeText(auto){

    }
}
