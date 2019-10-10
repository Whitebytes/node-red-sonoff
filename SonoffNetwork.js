'use strict';

module.exports = function (RED) {
    function SonoffNetwork(config) {
        // Create Node
        RED.nodes.createNode(this, config);

        // Setup mqtt broker
        const brokerConnection = RED.nodes.getNode(config.broker);

       
        this.updateState = function(state){
            this.context().set('state', state);
            if(state)
                this.status({fill: 'green', shape: 'dot', text: 'ON'});
            else
                this.status({fill: 'red', shape: 'ring', text: 'OFF'});
        }
        this.on('input', function(msg) {
            this.debug(`msg: ${msg}, payload: ${msg.payload}`)
            if (typeof(msg.payload)=='boolean'){
                this.updateState(msg.payload)
            }
        });

        if (brokerConnection) {
            brokerConnection.register(this);
            this.status({fill: 'yellow', shape: 'dot', text: 'Connecting...'});

            // Check if the node is online
            brokerConnection.subscribe('#', 2, (topic, payload) => {
                const stringPayload = payload.toString();
                this.debug(`Topic: ${topic}, Value: ${stringPayload}`);
            });
           
            // Remove Connections
            this.on('close', done => {
                brokerConnection.unsubscribe('#', this.id);
                brokerConnection.deregister(this, done);
            });
        } else {
            this.status({fill: 'red', shape: 'dot', text: 'Could not connect to mqtt'});
        }
    }

    RED.nodes.registerType('Sonoff Network', SonoffNetwork);
};