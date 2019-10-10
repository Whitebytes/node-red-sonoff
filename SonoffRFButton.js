'use strict';

module.exports = function (RED) {
    "use strict";

    function SonoffRFButton(config) {
        // Create Node
        RED.nodes.createNode(this, config);
        this.name =config.name;
        this.offAfter = config.offAfter || 60*5;//switch off after 5 minutes

        // Setup mqtt broker
        const brokerConnection = RED.nodes.getNode(config.broker);

        // Topics
        var topicTeleResult = `${config.telePrefix}/${config.device}/RESULT`;
        var topicLWTResult = `${config.telePrefix}/${config.device}/LWT`;
        var topicCmdStatus = `${config.cmdPrefix}/${config.device}/status`;

        if(config.mode == 1){ //Custom (%topic%/%prefix%/)
            topicTeleResult = `${config.telePrefix}/${config.device}/RESULT`;
            topicLWTResult = `${config.telePrefix}/${config.device}/LWT`;
            topicCmdStatus = `${config.device}/${config.cmdPrefix}/status`;
        }
        this.updateState = function(state){
            let text=this.state? 'ON' : 'OFF';
            if(this.state)
                this.status({fill: 'green', shape: 'dot', text});
            else
                this.status({fill: 'red', shape: 'ring', text});
        }

        this.on('input', function(msg) {
            if (typeof(msg.payload)=='boolean'){
                this.state=msg.payload;
                this.updateState();
            }
        });

        if (brokerConnection) {
            brokerConnection.register(this);
            this.status({fill: 'yellow', shape: 'dot', text: 'Connecting...'});

            // Check if the node is online
            brokerConnection.subscribe(topicLWTResult, 2, (topic, payload) => {
                const stringPayload = payload.toString();
                if (stringPayload === 'Online') {
                    this.status({fill: 'green', shape: 'ring', text: 'Online'});
                } else {
                    this.status({fill: 'red', shape: 'dot', text: 'Offline'});
                }
            });

            brokerConnection.subscribe(topicTeleResult, 2, (topic, payload) => {
                const stringPayload = payload.toString();
                var payload=JSON.parse(stringPayload);
                var btnPressed = payload.RfReceived.Data;
                if (!this.state)
                    this.state=false;
                var validButn =( 
                    !config.keyIds || //anything that moves
                    config.keyIds.length==0 ||  //anything that moves
                    config.keyIds.indexOf(btnPressed)>=0
                    );
               
                if (validButn) {
                    this.state = !this.state;
                    this.send({payload:this.state, key:btnPressed, topic:'buttonpress' })
                    this.updateState();
                }
                
            }, this.id);
            // Publish a start command to get the Status
            brokerConnection.client.publish(topicCmdStatus);
            this.status({fill: 'yellow', shape: 'ring', text: 'Requesting Status...'});

            // Remove Connections
            this.on('close', done => {
                brokerConnection.unsubscribe(topicTeleResult, this.id);
                brokerConnection.deregister(this, done);
            });
        } else {
            this.status({fill: 'red', shape: 'dot', text: 'Could not connect to mqtt'});
        }

    }

    RED.nodes.registerType('Sonoff RF Button', SonoffRFButton);
};