'use strict';

module.exports = function (RED) {
    function SonoffBasic(config) {
        // Create Node
        var node = RED.nodes.createNode(this, config);

        // Setup mqtt broker
        const brokerConnection = RED.nodes.getNode(config.broker);

        // Topics
        var topicTeleLWT = `${config.telePrefix}/${config.device}/LWT`;

        var topicCmdPower = `${config.cmdPrefix}/${config.device}/power`;
        var topicCmdStatus = `${config.cmdPrefix}/${config.device}/status`;

        var topicStatsPower = `${config.statPrefix}/${config.device}/POWER`;
        var topicStatsStatus = `${config.statPrefix}/${config.device}/STATUS`;

        if(config.mode == 1){ //Custom (%topic%/%prefix%/)
            topicTeleLWT = `${config.device}/${config.telePrefix}/LWT`;

            topicCmdPower = `${config.device}/${config.cmdPrefix}/power`;
            topicCmdStatus = `${config.device}/${config.cmdPrefix}/status`;

            topicStatsPower = `${config.device}/${config.statPrefix}/POWER`;
            topicStatsStatus = `${config.device}/${config.statPrefix}/STATUS`;
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

            brokerConnection.subscribe(topicStatsStatus, 2, (topic, payload) => {
                const stringPayload = payload.toString();

                try {
                    const jsonPayload = JSON.parse(stringPayload);
                    if (jsonPayload.Status.Power === 1) {
                        this.status({fill: 'green', shape: 'dot', text: 'On'});
                        this.send({payload: true, topic:topic});
                    } else {
                        this.status({fill: 'grey', shape: 'dot', text: 'Off'});
                        this.send({payload: false, topic:topic});
                    }
                } catch (err) {
                    this.status({fill: 'red', shape: 'dot', text: 'Error processing Status from device'});
                    this.error(err, 'Error processing Status from device');
                }
            }, this.id);

            // Subscribes if the state of the device changes
            brokerConnection.subscribe(topicStatsPower, 2, (topic, payload) => {
               
                const stringPayload = payload.toString();
                if (stringPayload === config.onValue) {
                    this.status({fill: 'green', shape: 'dot', text: 'On'});
                    this.send({payload: true, topic:topic});
                }
                if (stringPayload === config.offValue) {
                    this.status({fill: 'grey', shape: 'dot', text: 'Off'});
                    this.send({payload: false, topic:topic});
                }

            }, this.id);

            // On input we publish a true/false
            this.on('input', msg => {
                const payload = msg.payload;

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
                if (payload === true || payload === config.onValue) {
                    brokerConnection.client.publish(topicCmdPower, config.onValue, {qos: 0, retain: false});
                }

                if (payload === false || payload === config.offValue) {
                    brokerConnection.client.publish(topicCmdPower, config.offValue, {qos: 0, retain: false});
                }
            });

            // Publish a start command to get the Status
            brokerConnection.client.publish(topicCmdStatus);
            this.status({fill: 'yellow', shape: 'ring', text: 'Requesting Status...'});

            // Remove Connections
            this.on('close', done => {
                brokerConnection.unsubscribe(topicTeleLWT, this.id);
                brokerConnection.unsubscribe(topicStatsPower, this.id);
                brokerConnection.unsubscribe(topicStatsStatus, this.id);
                brokerConnection.deregister(this, done);
            });
        } else {
            this.status({fill: 'red', shape: 'dot', text: 'Could not connect to mqtt'});
        }
    }

    RED.nodes.registerType('Sonoff basic', SonoffBasic);
};