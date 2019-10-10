'use strict';

module.exports = function (RED) {
    "use strict";
    var SunCalc = require('suncalc');

    function SonoffPIR(config) {
        // Create Node
        RED.nodes.createNode(this, config);

        this.lat = config.lat || 52.6706437;
        this.lon = config.lon || 6.2900917;
        this.start = config.start || 'sunrise';
        this.end = config.end|| 'sunset';
        this.startOffset = config.startOffset  || 0;
        this.endOffset = config.endOffset  || 0;
        this.lightDepend = config.lightDepend  || 'always';
        this.name =config.name;
        this.offAfter = config.offAfter || 60*5;//switch off after 5 minutes
        this.remaining=0;
        this.msg={};
        var node = this;

       
        var toMills = function(moment, offsetInMinutes=0){

            return Date.UTC(
                moment.getUTCFullYear(),
                moment.getUTCMonth(),
                moment.getUTCDate(),
                moment.getUTCHours(),
                moment.getUTCMinutes()+parseInt(offsetInMinutes) );
        }
        var timStr = function (time,name){
            if (name)
                time=time[name];
            return time.getHours() + ':' + time.getMinutes().toString().padStart(2,'0');
        }
        var countDown =  function(secs){
            if (secs)
                node.remaining=secs;
               
            if (node.remaining ==0)
                node.send({...node.msg, payload:false });
            else{
                node.remaining--;
                node.timer = setTimeout(countDown,1000);
                node.updateState();
            }
        }

        var tick = function() {
            var now = new Date();
            var times = SunCalc.getTimes(now, node.lat, node.lon);
            var nowMillis = toMills(now);
            var startMillis = toMills(times[node.start], node.startOffset); 
            var endMillis =   toMills(times[node.end], node.endOffset); 
            var e1 = nowMillis - startMillis;
            var e2 = nowMillis - endMillis;
       
            if (isNaN(e1)) { e1 = 1; }
            if (isNaN(e2)) { e2 = -1; }
            var calcNight = (e1 > 0) & (e2 < 0) ? false: true;
            if (calcNight!=node.msg.isNight){
                node.send(null,{topic:'daylight',payload: !calcNight});
            }
            
            node.msg = {
                topic: 'pir',
                isNight:calcNight, 
                nauticalDawn: timStr(times, 'nauticalDawn'),
                dawn:timStr(times, 'dawn'),
                sunrise:timStr(times, 'sunrise'),
                sunriseEnd: timStr(times, 'sunriseEnd'),
                goldenHourEnd:timStr(times, 'goldenHourEnd'),
                goldenHour: timStr(times, 'goldenHour'),
                sunsetStart:timStr(times, 'sunsetStart'),
                sunset:timStr(times, 'sunset'),
                dusk:timStr(times, 'dusk'),
                nauticalDusk:timStr(times, 'nauticalDusk'),
                night:timStr(times, 'night'),
                start: timStr(new Date(startMillis)),
                end: timStr(new Date(endMillis)),
                now: timStr(new Date(nowMillis))
            };
           
            node.updateState.call(node);
        }

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
            
            var outState = this.remaining ? this.remaining +' secs': 'OFF' 
            let text=outState;
            var validTime = (
                this.lightDepend=='always' || 
                ((this.lightDepend=='night')== this.msg.isNight)
            )
            if (this.lightDepend=='night')
                text =`(${this.msg.end}-${this.msg.start}) ${validTime? outState : 'disarmed'}`;
            else if (this.lightDepend=='day')
                text =`(${this.msg.start}-${this.msg.end}) ${validTime? outState : 'disarmed'}`;
         

            if(this.remaining)
                this.status({fill: 'green', shape: 'dot', text});
            else
                this.status({fill: 'red', shape: 'ring', text});
        }

        this.on('input', function(msg) {
            if (typeof(msg.payload)=='boolean' && !msg.payload){
                this.remaining=0;
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
                
                var validButn =( 
                    !config.keyIds || //anything that moves
                    config.keyIds.length==0 ||  //anything that moves
                    config.keyIds.indexOf(btnPressed)>=0
                    );
                var validTime = (
                    this.lightDepend=='always' || 
                    ((this.lightDepend=='night')== this.msg.isNight)
                )
                if (validButn && validTime ) {
                    if ( this.remaining==0){
                        this.send({...this.msg, payload:true, key:btnPressed })
                        this.timer = countDown(this.offAfter);
                    }else {
                        this.remaining=this.offAfter;
                    }
                 return true;
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

        this.tick = setInterval(function() { tick(); }, 60000);
        this.tock = setTimeout(function() { tick(); }, 500);

        this.on("close", function() {
            if (this.tock) { clearTimeout(this.tock); }
            if (this.tick) { clearInterval(this.tick); }
        });
    }

    RED.nodes.registerType('Sonoff PIR', SonoffPIR);
};