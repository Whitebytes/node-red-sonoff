'use strict';


module.exports = function (RED) {
    function DhcpEvents(config) {
        // Create Node
        // be sure to have access to lower ports:
        //=> sudo setcap 'cap_net_bind_service=+ep' /usr/bin/node
        RED.nodes.createNode(this, config);
        var dhcp = require('dhcp');
        var fs =require('fs');
        const configFile = './network.json'
        
        const stringify = require("json-stringify-pretty-compact");
        var arpping = require('arpping')({timeout:1 });
 
        let networkConfig = {
            devices: [],
            settings:{
                pingEverySecs: 300, //5 minutes
                offlineAfter: 300 //5 minutes
            }
        }
        if (fs.existsSync(configFile)) {
            let rawdata = fs.readFileSync(configFile);  
            if (rawdata.indexOf>'{'>=0)
                networkConfig = JSON.parse(rawdata);  
        }
        this.saveConfig = ()=>{
            fs.writeFileSync(configFile, stringify(networkConfig), { flag: 'w' });
            this.send([null,{topic: 'dhcpEvent/deviceUpdste', payload: networkConfig}])
        }
        
         this.pingScan = () =>{
            const ipArray =networkConfig.devices.map((item)=>{return item.ipAddress});
            arpping.ping(ipArray, (err, found, missing) => {
                if (err) return this.debug(err);
                
                const onlineDevices = networkConfig.devices.filter((item)=>found.includes(item.ipAddress))
                onlineDevices.map((device)=>{
                    device.lastSeen = new Date()
                    if (device.isOffline){
                        device.isOffline=false;
                        this.debug(`${device.hostName} came  online`);
                        this.send([{topic: 'dhcpEvent/deviceOnline', payload: device}, null])
                    }
                })
                
                const offLineDevices = networkConfig.devices.filter((item)=>missing.includes(item.ipAddress))
                offLineDevices.map((device)=>{
                    const offlineTics= new Date()-new Date(device.lastSeen);
                    if (!device.isOffline && 
                        offlineTics > networkConfig.settings.offlineAfter*1000 ){
                            this.debug(`${device.hostName} went offline`);
                        device.isOffline=true;
                        this.send([{topic: 'dhcpEvent/deviceOffline', payload: device}, null])
                    }
                })
                this.saveConfig();
            });
        }
        //evry 5 minutes
        this.pingScan(); //now and forever
        this.pingTimer = setInterval(()=>{
            this.pingScan();
        }, networkConfig.settings.pingEverySecs*1000)
    
        let dhcpListener;
        try {
            dhcpListener = dhcp.createBroadcastHandler();
            dhcpListener.listen();
            this.status({fill: 'green', shape: 'dot', text: 'sniffing..'});
            this.saveConfig()
        }
        catch (exception){
            this.status({fill: 'red', shape: 'ring', text: exception.toString()});
        }
        
        dhcpListener.on('message', (data)=> {
            if (data.options[53] === dhcp.DHCPREQUEST) {
                var props = {
                    hostName : data.options[12],
                    ipAddress :  data.options[50],
                    macAddress : data.chaddr,
                    lastSeen: new Date(),
                    lastConnected: new Date(),
                    isOffline :false
                }
                if (!props.hostName || props.hostName.startsWith('UPCGW_')) //mediabox..
                    return ;
                var device = networkConfig.devices.find(
                    (item) => {return item.hostName==props.hostName} )
                if (!device){
                    device=props;
                    networkConfig.devices.push(device);
                }
                else
                    Object.assign(device, props)  
                this.send([{topic: 'dhcpEvent/deviceOnline', payload: device}, null])
                this.saveConfig();
            }
           
        })   
         
        this.on('close', done => {
            clearInterval(this.pingTimer);
        });
        
    }

    RED.nodes.registerType('Dhcp events', DhcpEvents);
};