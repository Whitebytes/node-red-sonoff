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
        var currState = states.UNKNOWN;

        // Setup mqtt broker
        const brokerConnection = RED.nodes.getNode(config.broker);

        // Topics
        var topicTeleLWT = `${telePrefix}/${config.device}/LWT`;

        var topicCmdPower = `${cmdPrefix}/${config.device}/power`;
        var topicCmdStatus = `${cmdPrefix}/${config.device}/status`;

        var topicStatsPower = `${statPrefix}/${config.device}/POWER`;
        var topicStatsStatus = `${statPrefix}/${config.device}/STATUS`;

        var groupComands = `group-${cmdPrefix}/+/POWER`;

        let handleState = (isOn, topic) =>{
            if (isOn && currState!=states.ON){
                this.send({payload: true, topic:topic});
                currState=states.ON;
            } else if (!isOn && currState!=states.OFF){
                this.send({payload: false, topic:topic});
                currState=states.OFF;
            }
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
                    if (jsonPayload.Status.Power === 1) {
                        this.status({fill: 'green', shape: 'dot', text: 'On'});
                        handleState(true, topic);
                    } else {
                        this.status({fill: 'grey', shape: 'dot', text: 'Off'});
                        handleState(false, topic);
                    }
                } catch (err) {
                    this.status({fill: 'red', shape: 'dot', text: 'Error processing Status from device'});
                    this.error(err, 'Error processing Status from device');
                }
            }, this.id);

            // Subscribes if the state of the device changes
            brokerConnection.subscribe(topicStatsPower, 2, (topic, payload) => {
                const stringPayload = payload.toString();
                if (stringPayload === onValue) {
                    this.status({fill: 'green', shape: 'dot', text: 'On'});
                    //states was changed without our knowledge, eg hardware switch
                    handleState(true, topic);
                }
                if (stringPayload === offValue) {
                    this.status({fill: 'grey', shape: 'dot', text: 'Off'});
                    //states was changed without our knowledge
                    handleState(false, topic);
                }

            }, this.id);

            if ( config.groupTopics &&  config.groupTopics.length>0 )
                brokerConnection.subscribe(groupComands, 2, (topic, payload) => {
                let data = JSON.parse(payload)
                let group= topic.split('/')[1];
                if (
                    config.groupTopics.indexOf(group)>=0){
                        this.handleInput(data.POWER);
                    }

            }, this.id);
            
            this.handleInput = (payload)=>{
                //prevent loops over a relay, can cause serious damage to hardware
                const lastTime = this.context().get('lastTime') || new Date(Date.now()-config.minInterval-1);
                const since = Date.now() - lastTime;
                
                if (since < config.minInterval){
                    this.debug(`Switch command to fast (${since}ms) behind previous command, 
                        see node settings to decrease switchtime(now: ${config.minInterval})`)
                    return;
                }
                this.context().set('lastTime', Date.now());

                // We handle boolean, the onValue and msg.On to support homekit
                if (payload === true || payload === onValue) {
                    brokerConnection.client.publish(topicCmdPower, onValue, {qos: 0, retain: false});
                    handleState(true, topicCmdPower);
                }

                if (payload === false || payload === offValue) {
                    brokerConnection.client.publish(topicCmdPower, offValue, {qos: 0, retain: false});
                    handleState(false, topicCmdPower);
                }

            }

            // On input we publish a true/false
            this.on('input', msg => {
                this.handleInput(msg.payload)
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
                
            });
        } else {
            this.status({fill: 'red', shape: 'dot', text: 'Could not connect to mqtt'});
        }
    }

    RED.nodes.registerType('Sonoff basic', SonoffBasic);
};