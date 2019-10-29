'use strict';

module.exports = function (RED) {
    let states={
        ON:1,
        OFF:0,
        WAITING_FEEDBACK:2,
        UNKNOWN:3
    }
    function SonoffBasic(config) {
        // Create Node
        var node = RED.nodes.createNode(this, config);
        var statPrefix = 'stat';
        var telePrefix = 'tele';
        var cmdPrefix = 'cmnd';
        var onValue = 'ON';
        var offValue = 'OFF';
        var minInterval = 500; //dont switch within 500ms

        var currState = states.UNKNOWN;
        var timeOut = 1500;//expect response in 1.5 secs
        var currTimer = null
        var maxOn = config.maxOn ||-1;
        var lastTime = Date.now();
        var downCounter = -1;

        // Setup mqtt broker
        const brokerConnection = RED.nodes.getNode(config.broker);

        // Topics
        var topicTeleLWT = `${telePrefix}/${config.device}/LWT`;

        var topicCmdPower = `${cmdPrefix}/${config.device}/power`;
        var topicCmdStatus = `${cmdPrefix}/${config.device}/status`;

        var topicStatsPower = `${statPrefix}/${config.device}/POWER`;
        var topicStatsStatus = `${statPrefix}/${config.device}/STATUS`;

        var groupComands = `group-${cmdPrefix}/+/POWER`;


        let isOn = (value)=>{
            return ( 
                (typeof(value)=='string' && value.toLowerCase()=='on')
                || value==1 
                || value==true);
        }
        let isSame =  (value1, value2) => {
            return (isOn(value1)===isOn(value2));
        }
       
        let setPowerState = (powerState)=>{

             //prevent relay vibrations / debounce
             let since = Date.now() - lastTime;
             if (since < minInterval){
                 this.debug(`Switch command to fast (${since}ms) behind previous command, 
                     see node settings to decrease switchtime(now: ${minInterval})`)
                 return;
             }
            lastTime=Date.now()

            if (isSame(currState, powerState))
              return;

            this.debug(`${config.device} has state ${currState}, sending new state: ${powerState}`);
            //let hardware know!
            brokerConnection.client.publish(topicCmdPower, isOn(powerState)? onValue : offValue, {qos: 0, retain: false});

            currTimer = setTimeout(()=>{
                updateState(states.UNKNOWN);//only on timeouts..
            }, timeOut)
            currState =  states.WAITING_FEEDBACK;
            downCounter=-1;
        }

        let updateState = (state)=>{
            state = isOn(state)?states.ON:states.OFF;
           
            if (state==currState) //prevent loops..
                return;
            currState=state;

            if (currTimer)
                clearTimeout(currTimer);
            
            //let the world oudside mqtt know the change..
            this.send({topic:topicStatsStatus, payload: isOn(currState)});

            if (isOn(currState) && maxOn>2 ){ 
                downCounter=maxOn;
                countDown();
            }

            if (isOn(currState))
                this.status({fill: 'green', shape: 'dot', text: 'On'});
            else 
                this.status({fill: 'red', shape: 'dot', text: 'Off'});
        }
        
        let countDown=()=>{
            if (downCounter==0)
                setPowerState(states.OFF);//only on timeouts..
            if (downCounter<=0){
                downCounter=-1;
                clearTimeout(currTimer);
            } else{
                currTimer = setTimeout(()=>{
                    downCounter--;
                    if (downCounter>=0){
                        this.status({fill: 'green', shape: 'ring', text: `On (${downCounter} secs..)`});
                        countDown();
                    }
                },1000)
            }
        } 

        let onInput = (powerState)=>{
            if (isSame(powerState, currState)) 
                return; //prevent loops
            if (currState==states.WAITING_FEEDBACK)
                return; //one thing at a time

            setPowerState(powerState);
        }
            
        if (brokerConnection) {
            brokerConnection.register(this);
            this.status({fill: 'yellow', shape: 'dot', text: 'Connecting...'});

            // Check if the node is online
            brokerConnection.subscribe(topicTeleLWT, 2, (topic, payload) => {
                const stringPayload = payload.toString();
               
                if (stringPayload === 'Online') {
                    this.status({fill: 'green', shape: 'ring', text: 'Online'});
                } else {
                    this.status({fill: 'red', shape: 'dot', text: 'Offline'});
                }
            });
            
            //handles all sonoff status reports
            brokerConnection.subscribe(topicStatsStatus, 2, (topic, payload) => {
                const stringPayload = payload.toString();
                try {
                    const jsonPayload = JSON.parse(stringPayload);
                    updateState(jsonPayload.Status.Power);
                  
                } catch (err) {
                    this.status({fill: 'red', shape: 'dot', text: 'Error processing Status from device'});
                    this.error(err, 'Error processing Status from device');
                }
            }, this.id);

            // Subscribes if the state of the device changes
            brokerConnection.subscribe(topicStatsPower, 2, (topic, payload) => {
                const stringPayload = payload.toString();
                updateState(stringPayload);
            }, this.id);

            if ( config.groupTopics &&  config.groupTopics.length>0 ){
                brokerConnection.subscribe(groupComands, 2, (topic, payload) => {
                    let data = JSON.parse(payload)
                    let group= topic.split('/')[1];

                    if (config.groupTopics.indexOf(group)>=0){
                        onInput(data.POWER);
                    }
                }, this.id);
            }
      
            // On input we publish a true/false
            this.on('input', msg => {
                onInput(msg.payload);  
            });

            // Publish a start command to get the Status
            brokerConnection.client.publish(topicCmdStatus);
            this.status({fill: 'yellow', shape: 'ring', text: 'Requesting Status...'});

            // Remove Connections
            this.on('close', done => {
                brokerConnection.unsubscribe(topicTeleLWT, this.id);
                brokerConnection.unsubscribe(topicStatsPower, this.id);
                brokerConnection.unsubscribe(topicStatsStatus, this.id);
                brokerConnection.unsubscribe(groupComands, this.id);
                brokerConnection.deregister(this, done);
                downCounter==-1;
                clearTimeout(currTimer);
                
            });
        } else {
            this.status({fill: 'red', shape: 'dot', text: 'Could not connect to mqtt'});
        }
    }

    RED.nodes.registerType('Sonoff basic', SonoffBasic);
};