import { createClient } from 'redis'
import { Schema, Repository, EntityId } from 'redis-om'
import express, { query } from 'express'
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';

const redis = createClient()
await redis.connect()

const schema = new Schema('issue', {
    author: { type: 'string', path: '$.author' },
    title: { type: 'text', path: '$.title' },
    created: { type: 'number', path: '$.created', sortable: true },

    tags: { type: 'string[]', path: '$.tags[*]' },
    part: { type: 'string[]', path: '$..author' },

    num_comments: { type: 'number', path: 'length($.comments)', sortable: true },
    last_updated: { type: 'number', path: 'max($.comments[*].updated)', sortable: true }
}, {
    dataStructure: 'JSON'
})

let issueRepository = new Repository(schema, redis)
try {
    await issueRepository.createIndex()
} catch (e) {
    console.log(e);
}

const app = express();

app.set('view engine', 'pug')
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

function currentTimeInt() {
    return new Date().getTime() - new Date(2023, 10, 1).getTime();
}

app.post("/create", async function (req, res) {
    let author = req.cookies['username']
    if (!req.body.title || !author) {
        res.redirect("/")
        return
    }

    let issue = {
        title: req.body.title,
        author: author,
        created: currentTimeInt(),
        tags: req.body.tags.split(",").map(s => s.trim()),
        comments: [
            {
                text: `${author} created the issue on ${new Date()}`,
                author: author,
                updated: currentTimeInt()
            }
        ]
    }

    issue = await issueRepository.save(issue)
    res.redirect("/")
})


async function fetchIssues(req) {
    let queryBuilder = issueRepository.search()

    let words = [];
    if (req.query.query) {
        for (let word of req.query.query.split(' ')) {
            if (word.trim())
                words.push(word.trim());
        }
    }

    for (let word of words) {
        if (word.startsWith('author:')) {
            queryBuilder = queryBuilder.where('author').equals(word.substr(7))
        } else if (word.startsWith('part:')) {
            queryBuilder = queryBuilder.where('part').contains(word.substr(5))
        } else if (word.startsWith('tag:')) {
            queryBuilder = queryBuilder.where('tags').contains(word.substr(4))
        } else {
            queryBuilder = queryBuilder.where('title').matches(word.trim())
        }
    }


    if (req.query.sort === "commented")
        queryBuilder = queryBuilder.sortDescending('num_comments')
    else if (req.query.sort === "updated")
        queryBuilder = queryBuilder.sortDescending('last_updated')
    else
        queryBuilder = queryBuilder.sortDescending('created')

    let issues = await queryBuilder.return.all()
    for (let issue of issues)
        issue.href = `/i/${issue[EntityId]}`

    return issues;
}


app.get("/", async function (req, res) {
    let issues = [];
    try {
        issues = await fetchIssues(req);
    } catch (e) {
        console.log(e)
        res.send("error");
        return
    }

    res.render('index', { issues: issues, username: req.cookies['username'] ?? "anonymous" })
});

app.get("/i/:id", async function (req, res) {
    let issue = await issueRepository.fetch(req.params.id)
    res.render('view', { issue: issue, commentUrl: `/c/${req.params.id}` })
});

app.post("/c/:id", async function (req, res) {
    let comment = {
        author: req.cookies['username'] ?? 'anonymous',
        text: req.body.text,
        updated: new Date().getTime() - 1698699633564,
    }
    let issue = await issueRepository.fetch(req.params.id)
    issue.comments.push(comment)

    issueRepository.save(issue)
    res.redirect(`/i/${req.params.id}`)
})


// aux parts

app.get("/create", async function (req, res) {
    res.render('create', {})
});

app.get("/rename", async function (req, res) {
    res.render('rename', { username: req.cookies['username'] })
})

app.post("/rename", async function (req, res) {
    res.cookie('username', req.body.username, {})
    res.redirect("/")
})

app.get("/q", async function (req, res) {
    res.render('query', { lres: "", last: "" })
})

app.post("/q", async function (req, res) {
    const code = req.body['code'];
    let lres = "";
    try {
        lres = await redis.sendCommand(code.match(/(?:[^\s"]+|"[^"]*")+/g).map((s) => {
            if (s.startsWith('"')) return s.substring(1, s.length - 1);
            else return s;
        }));
    } catch (e) {
        lres = e.toString();
    }
    res.render('query', { lres: JSON.stringify(lres, null, 2), last: code })
})


app.listen(3000)
