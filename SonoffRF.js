"use strict";

module.exports = function(RED) {
  "use strict";
  var SunCalc = require("suncalc");
  let states = {
    ON: 1,
    OFF: 0,
    OBEY_OFF: 2,
    UNKNOWN: 3
  };

  function SonoffRF(config) {
    // Create Node
    RED.nodes.createNode(this, config);

    const telePrefix = "tele";
    const cmdPrefix = "cmnd";
    var rfState = states.UNKNOWN;
    var node = this;
    node.msg = {};
    let isOn = value => {
      return (
        (typeof value == "string" && value.toLowerCase() == "on") ||
        value == 1 ||
        value == true
      );
    };

    let armed = () => {
      return (
        config.lightDepend == "always" ||
        (config.lightDepend == "night") == node.msg.isNight
      );
    };

    var toMills = function(moment, offsetInMinutes = 0) {
      return Date.UTC(
        moment.getUTCFullYear(),
        moment.getUTCMonth(),
        moment.getUTCDate(),
        moment.getUTCHours(),
        moment.getUTCMinutes() + parseInt(offsetInMinutes)
      );
    };
    var timStr = function(time, name) {
      if (name) time = time[name];
      return (
        time.getHours() +
        ":" +
        time
          .getMinutes()
          .toString()
          .padStart(2, "0")
      );
    };

    var powerStateChange = state => {
      if (!isOn(state) && config.rfType == "pir") {
        setTimeout(() => {
          rfState = states.OFF;
          showState();
        }, config.offObey * 1000);
        rfState = states.OBEY_OFF; //disable pir motions
      } else {
        rfState = state;
      }

      showState();
    };

    var rfReceived = () => {
      let state = "toggle";
      let timerSecs = config.offAfter;
      if (config.rfType == "pir") {
        if (rfState == states.OBEY_OFF) return;
        state = "on";
      }
      this.send({ ...this.msg, payload: state, timerSecs });
      rfState = state;
      showState();
    };

    let showState = () => {
      let text;
      switch (rfState) {
        case states.OBEY_OFF:
          text = "Obey off";
          break;
        case states.UNKNOWN:
          text = "-";
          break;
        default:
          text = isOn(rfState) ? "On" : "Off";
      }
      if (config.lightDepend == "night")
        text = `(${this.msg.end}-${this.msg.start}) ${
          armed() ? text : "disarmed"
        }`;
      else if (config.lightDepend == "day")
        text = `(${this.msg.start}-${this.msg.end}) ${
          armed() ? text : "disarmed"
        }`;

      let fill = isOn(rfState) ? "green" : "grey";
      let shape = armed() ? "dot" : "ring";

      this.status({ fill, shape, text });
    };

    var tick = function() {
      var now = new Date();
      var times = SunCalc.getTimes(now, config.lat, config.lon);
      var nowMillis = toMills(now);
      var startMillis = toMills(times[config.start], config.startOffset);
      var endMillis = toMills(times[config.end], config.endOffset);
      var e1 = nowMillis - startMillis;
      var e2 = nowMillis - endMillis;

      if (isNaN(e1)) {
        e1 = 1;
      }
      if (isNaN(e2)) {
        e2 = -1;
      }
      var calcNight = (e1 > 0) & (e2 < 0) ? false : true;
      if (calcNight != node.msg.isNight) {
        node.send(null, { topic: "daylight", payload: !calcNight });
      }

      node.msg = {
        topic: "pir",
        isNight: calcNight,
        start: timStr(new Date(startMillis)),
        end: timStr(new Date(endMillis)),
        now: timStr(new Date(nowMillis))
      };
      showState();
    };

    // Setup mqtt broker
    const brokerConnection = RED.nodes.getNode(config.broker);

    // Topics
    var topicTeleResult = `${telePrefix}/${config.device}/RESULT`;
    var topicLWTResult = `${telePrefix}/${config.device}/LWT`;
    var topicCmdStatus = `${cmdPrefix}/${config.device}/status`;

    this.on("input", function(msg) {
      powerStateChange(msg.payload);
    });

    if (brokerConnection) {
      brokerConnection.register(this);
      this.status({ fill: "yellow", shape: "dot", text: "Connecting..." });

      // Check if the node is online
      brokerConnection.subscribe(topicLWTResult, 2, (topic, payload) => {
        const stringPayload = payload.toString();
        if (stringPayload === "Online") {
          this.status({ fill: "green", shape: "ring", text: "Online" });
        } else {
          this.status({ fill: "red", shape: "dot", text: "Offline" });
        }
      });

      brokerConnection.subscribe(
        topicTeleResult,
        2,
        (topic, payload) => {
          const stringPayload = payload.toString();
          var payload = JSON.parse(stringPayload);
          var btnPressed = payload.RfReceived.Data;

          var validButn =
            !config.keyIds || //anything that moves
            config.keyIds.length == 0 || //anything that moves
            config.keyIds.indexOf(btnPressed) >= 0;

          if (validButn && armed()) rfReceived();
        },
        this.id
      );
      // Publish a start command to get the Status
      brokerConnection.client.publish(topicCmdStatus);
      this.status({
        fill: "yellow",
        shape: "ring",
        text: "Requesting Status..."
      });

      // Remove Connections
      this.on("close", done => {
        brokerConnection.unsubscribe(topicTeleResult, this.id);
        brokerConnection.deregister(this, done);
      });
    } else {
      this.status({
        fill: "red",
        shape: "dot",
        text: "Could not connect to mqtt"
      });
    }

    this.tick = setInterval(function() {
      tick();
    }, 60 * 1000);
    this.tock = setTimeout(function() {
      tick();
    }, 500);

    this.on("close", function() {
      if (this.tock) {
        clearTimeout(this.tock);
      }
      if (this.tick) {
        clearInterval(this.tick);
      }
    });
  }

  RED.nodes.registerType("Sonoff RF", SonoffRF);
  RED.httpAdmin.get("/node-red-sonoff/js/*", function(req, res) {
    var options = {
      root: __dirname + "/static/",
      dotfiles: "deny"
    };
    res.sendFile(req.params[0], options);
  });
};
