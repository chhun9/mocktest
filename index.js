const httpProxy = require('http-proxy')
const bodyParser = require('body-parser')
const kafkaJs = require('kafkajs')
const express = require('express')
const spawn = require('child_process')

const workingDirectory = 'swagger'
const mockWheelServerName = 'MOCK WHEEL SERVER'
const mockBodyServerName = 'MOCK BODY SERVER'
const mockEngineServerName = 'MOCK ENGINE SERVER'
const kafkaUrl = 'localhost:9092'

const bodySwagger = './mock-body-swagger.json'
const mockBodyPort = 13001
const kafkaBodyPort = 23001

const engineSwagger = './mock-engine-swagger.json'
const mockEnginePort = 13002
const kafkaEnginePort = 23002

const wheelSwagger = './mock-wheel-swagger.json'
const mockWheelPort = 13003
const kafkaWheelPort = 23003

const mockBodyUrl = `http://localhost:${mockBodyPort}`
const mockWheelUrl = `http://localhost:${mockWheelPort}`
const mockEngineUrl = `http://localhost:${mockEnginePort}`

const kafkaResponseDelay = 1500

const startMockServer = (mockPort, swaggerFileName) => {
    const mock = spawn.spawn('prism mock', ['--host', '0.0.0.0', '-p', mockPort, '-d', swaggerFileName,'-v','debug'], {
        shell: true, cwd: workingDirectory
    })
    mock.stdout.on('data', (data) => {
        data = data.toString().replace(/\r?\n|\r/g, ' ')
        console.log(`stdout : ${data}`)
    })
    mock.stderr.on('data', (data) => {
        data = data.toString().replace(/\r?\n|\r/g, ' ')
        console.log(`stderr : ${data}`)
    })
    mock.on('close', (code) => {
        console.log(`child process exited with code : ${code}`)
        mock.kill(code)
    })
}

const kafkaSender = async (topicName, messageKey, message) => {
    const kafkaClient = new kafkaJs.Kafka({brokers: [kafkaUrl]})
    const producer = kafkaClient.producer({createPartitioner: kafkaJs.Partitioners.LegacyPartitioner})

    let payloads = {
        topic: topicName, messages: [{key: messageKey, value: message}]
    }

    console.log('-----------------------------------------')
    console.log(`KAFKA SEND`)
    console.log('-----------------------------------------')
    console.log(`topic : ${payloads.topic}`)
    console.log(`messageKey : ${payloads.messages[0].key}`)
    console.log(`messageValue : ${payloads.messages[0].value}`)
    console.log('-----------------------------------------')

    await producer.connect()
    await producer.send(payloads)
        .then(console.log)
        .catch(e => console.error(e))
}

const mockProxyServer = (serverName, serverUrl, kafkaPort, mockPort, swaggerFileName) => {
    startMockServer(mockPort, swaggerFileName)

    let option = {
        target: serverUrl,
        selfHandleResponse: true
    }
    const proxyServer = httpProxy.createProxyServer()
    proxyServer.on('proxyReq', (proxyReq, req, res) => {
        proxyReq.setHeader('Content-Type', 'application/json')
        if (req.body && Object.keys(req.body).length > 0) {
            proxyReq.setHeader('Content-Length', Buffer.byteLength(JSON.stringify(req.body)))
            proxyReq.write(JSON.stringify(req.body))
            console.log('-----------------------------------------')
            console.log(`REQUEST DATA`)
            console.log(req.body)
            console.log('-----------------------------------------')
        }
    })

    proxyServer.on('proxyRes', (proxyRes, req, res) => {
        let body = []
        res.setHeader('Content-Type', 'application/json')
        proxyRes.on('data', (chunk) => {
            body.push(chunk)
        })
        proxyRes.on('end', () => {
            body = Buffer.concat(body).toString()
            let bodyJson = {status: 'success', result: JSON.parse(body)}

            if (req?.body?.kafka) {
                setTimeout(kafkaSender, kafkaResponseDelay, req.body.kafka.topic, req.body.kafka.messageKey, JSON.stringify(bodyJson))
                res.end('ok')
            }
        })
    })

    const mockServer = express()
    mockServer.use(bodyParser.json())
    mockServer.use(bodyParser.urlencoded({extended: true}))

    mockServer.use((req, res) => {
        proxyServer.web(req, res, option)
    })
    console.log(`Listening ${serverName} With kafka on port ${kafkaPort} Only mock on port ${mockPort}`)
    mockServer.listen(kafkaPort)
}

mockProxyServer(mockBodyServerName, mockBodyUrl, kafkaBodyPort, mockBodyPort, bodySwagger)
mockProxyServer(mockEngineServerName, mockEngineUrl, kafkaEnginePort, mockEnginePort, engineSwagger)
mockProxyServer(mockWheelServerName, mockWheelUrl, kafkaWheelPort, mockWheelPort, wheelSwagger)