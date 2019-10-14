const fetch = require('node-fetch')
const crypto = require('crypto')

const ip = process.env.IP
const password = process.env.PASSWORD
var token = null

var usageAt = 0
var attemptedFix = false
var day
const interval = 5000

//Timestamps in front of all log messages

async function main() {
    // Char \ needs to be escaped so ASCII Looks a little weird in-editor
    console.log(`
    \x1b[31m
     _______ ______ _      ______ ___    _____  ______ _____          _____  
    |__   __|  ____| |    |  ____|__ \\  |  __ \\|  ____/ ____|   /\\   |  __ \\ 
       | |  | |__  | |    | |__     ) | | |  | | |__ | |       /  \\  | |__) |
       | |  |  __| | |    |  __|   / /  | |  | |  __|| |      / /\\ \\ |  ___/ 
       | |  | |____| |____| |____ / /_  | |__| | |___| |____ / ____ \\| |     
       |_|  |______|______|______|____| |_____/|______\\_____/_/    \\_\\_|     
    \x1b[0m
    `)

    var origlog = console.log

    console.log = function (obj, ...placeholders) {
        if (typeof obj === 'string')
            placeholders.unshift("[" + new Date().toUTCString() + "] " + obj)
        else {
            // This handles console.log( object )
            placeholders.unshift(obj)
            placeholders.unshift(Date.now() + " %j")
        }

        origlog.apply(this, placeholders)
    }

    day = new Date().getDate()

    console.log("Logging in")
    token = await doLogin()


    console.log("Starting with unknown limit, setting to current usage +5GB")
    usageAt = await getUsage() + 5

    mainLoop()

    // setInterval(async ()=>{
    //     let date = new Date()
    //     console.log("Sending")
    //     let result = await webCGI({
    //         token: token,
    //         module: "message",
    //         action: 3,
    //         sendMessage: {
    //             "to": "1280",
    //             textContent: "1GB EXTRA",
    //             sendTime: `${date.getFullYear()},${date.getMonth()+1},${date.getDate()},${date.getHours()},${date.getMinutes()},${date.getSeconds()}`
    //         }
    //     })
    // }, 1000)
}

async function mainLoop() {

    let newday = new Date().getDate()
    if (day !== newday) {
        //We have hit midnight, this resets our cap to 5GB, so we set usageAt accordingly
        let usage = await getUsage()
        usageAt = usage + 5
        day = newday
    }

    //Check usage
    let usage = await getUsage()
    if (usage > usageAt - .6) { //Check if we are out of data, with a 600MB Buffer, as to not recieve SMS messages
        console.log("Hit cap estimate with 600MB Buffer")
        usageAt = usageAt + 1
        await send1GB()
    }

    //Check Messages
    let fixed = await checkMessages()
    if (fixed) {
        setTimeout(mainLoop, interval * 2)
    }

    //Checking connection
    let status = await checkConnection()
    if (status == false) {
        if (attemptedFix == false) {
            //No internet connection!
            //TODO Alert user via hass/telegram etc.

            usage = await getUsage()

            console.log(`Internet connection has dropped @${usage}GB, estimated was @${usageAt}GB`)

            attemptedFix = true
            usage = await getUsage() + 1
            await Promise.all([
                send1GB(),
                // send1GB(),
                // send1GB(),
                // send1GB(),
                // send1GB()
            ])
        } else {
            console.log("Still no connection available")
        }
    } else {
        if (attemptedFix == true) {
            console.log("Connection has been retured")
            attemptedFix = false
        }
        //Connection is working perfectly
    }

    setTimeout(mainLoop, interval)
}

async function checkMessages() {
    let messageList = await webCGI({
        token: token,
        module: "message",
        action: 2,
        pageNumber: 1,
        amountPerPage: 8,
        box: 0
    })
    let fixed = false
    for (let i in messageList.messageList) {
        let message = messageList.messageList[i]
        if (message.unread === false) continue

        //Mark message as read
        await webCGI({
            token: token,
            module: "message",
            action: 6,
            markReadMessage: message.index
        })

        if (fixed) continue

        //Check message content
        if (message.content.includes("U heeft 100% van uw dagbundel bereikt.")) {
            console.log("Tele2 SMS, 0MB Left")
            await send1GB()
            fixed = true
            usageAt = await getUsage() + 1 //Set usageAt to a precise number, 1.5GB From current usage
        }
        else if (message.content.includes("U heeft nog 500MB over van uw dagbundel")) {
            console.log("Tele2 SMS, 500MB Left")
            await send1GB()
            fixed = true
            usageAt = await getUsage() + 1.5 //Set usageAt to a precise number, 1.5GB From current usage
        }
    }
    return fixed
}

async function send1GB() {
    let date = new Date()
    console.log("sending 1GB Message")
    let result = await webCGI({
        token: token,
        module: "message",
        action: 3,
        sendMessage: {
            "to": "1280",
            textContent: "1GB EXTRA",
            sendTime: `${date.getFullYear()},${date.getMonth() + 1},${date.getDate()},${date.getHours()},${date.getMinutes()},${date.getSeconds()}`
        }
    })

    await new Promise((res) => setTimeout(res, 5000))

}

async function doLogin() {
    let login1 = await authCGI({ module: "authenticator", action: 0 })
    let nonce = login1.nonce
    let hash = crypto.createHash("md5").update(password + ":" + nonce).digest("hex")
    let login2 = await authCGI({ module: "authenticator", action: 1, digest: hash })
    return login2.token
}

async function getUsage() {
    let data = await webCGI({
        token: token,
        module: "status",
        action: 0
    })
    let usage = data.wan.totalStatistics / 1024 / 1024 / 1024
    usage = Math.round(usage * 1000) / 1000
    return usage
}

async function checkConnection() {
    try {
        result = await fetch("https://nickremijn.nl/",
            {
                redirect: "manual",
                follow: 0,
                timeout: 2000 //Max 2S timeout to keep script running if internet is fubar
            })
    } catch (e) {
        return false
    }

    if (result.headers.get('location') === "http://remijn.io/") {
        //Connection is fine!
        return true
    } else {
        return false
    }
}

async function webCGI(data) {
    let result
    try {
        result = await fetch("http://192.168.0.1/cgi-bin/web_cgi", {
            "credentials": "include",
            "headers": {
                "accept": "application/json, text/javascript, */* q=0.01",
                "accept-language": "en-US,enq=0.9,nlq=0.8",
                "cache-control": "no-cache",
                "content-type": "application/x-www-form-urlencoded charset=UTF-8",
                "pragma": "no-cache",
                "x-requested-with": "XMLHttpRequest"
            },
            "body": JSON.stringify(data),
            "method": "POST",
        })
        var data = await result.json()
        return data
    } catch (e) {
        console.error(e, '')
        console.error(result)
        throw e
    }

}

async function authCGI(data) {
    var result = await fetch("http://192.168.0.1/cgi-bin/auth_cgi", {
        "credentials": "include",
        "headers": {
            "accept": "application/json, text/javascript, */* q=0.01",
            "accept-language": "en-US,enq=0.9,nlq=0.8",
            "cache-control": "no-cache",
            "content-type": "application/x-www-form-urlencoded charset=UTF-8",
            "pragma": "no-cache",
            "x-requested-with": "XMLHttpRequest"
        },
        "body": JSON.stringify(data),
        "method": "POST",
    })
    var data = await result.json()
    return data
}

main()