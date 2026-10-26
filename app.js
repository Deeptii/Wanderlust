const express = require("express");
const app = express();
const mongoose = require("mongoose");
const Listing = require("./models/listing");
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const wrapAsync = require("./utils/wrapAsync");
const ExpressError = require("./utils/ExpressError");
const { reviewSchema } = require("./schema");
const Review = require("./models/review");
const { data: sampleListings } = require("./init/data");

const session = require('express-session');
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const User = require('./models/user');

const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/wanderlust";

main()
    .then(() => {
        console.log("connected to db");
    })
    .catch((err) => {
        console.log(err);
    });

async function main() {
    await mongoose.connect(MONGO_URL);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.engine("ejs", ejsMate);
app.use(express.static(path.join(__dirname, "public")));

// Session config
app.use(session({
    secret: process.env.SESSION_SECRET || 'development-only-secret',
    resave: false,
    saveUninitialized: true,
}));
app.use(flash());

// Passport config
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// Flash and currentUser middleware
app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
});

const renderListings = wrapAsync(async (req, res) => {
    const databaseAvailable = mongoose.connection.readyState === 1;
    const allListings = databaseAvailable ? await Listing.find({}) : sampleListings;
    res.render("listings/index", { allListings, isSampleListings: !databaseAvailable });
});

app.get("/", renderListings);

// Auth routes
app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', wrapAsync(async (req, res, next) => {
    try {
        const { email, username, password } = req.body;
        const user = new User({ email, username });
        const registeredUser = await User.register(user, password);
        req.login(registeredUser, err => {
            if (err) return next(err);
            req.flash('success', 'Welcome to WanderLust!');
            res.redirect('/listings');
        });
    } catch (e) {
        req.flash('error', e.message);
        res.redirect('/register');
    }
}));

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', passport.authenticate('local', {
    failureFlash: true,
    failureRedirect: '/login',
}), (req, res) => {
    req.flash('success', 'Welcome back!');
    res.redirect('/listings');
});

app.get('/logout', (req, res, next) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        req.flash('success', 'Logged out successfully.');
        res.redirect('/listings');
    });
});

const validateReview = (req, res, next) => {
    const { error } = reviewSchema.validate(req.body);
    if (error) {
        throw new ExpressError(400, error.details.map(el => el.message).join(","));
    } else {
        next();
    }
};

//Index Route
app.get("/listings", renderListings);

//New Route
app.get("/listings/new", (req, res) => {
    res.render("listings/new");
});

//show route
app.get("/listings/:id", wrapAsync(async (req, res) => {
    let { id } = req.params;
    const listing = await Listing.findById(id).populate("reviews");
    res.render("listings/show", { listing });
}));

// Book route
app.post('/listings/:id/book', (req, res) => {
    if (!req.user) {
        req.flash('error', 'You must be logged in to book.');
        return res.redirect(`/listings/${req.params.id}`);
    }
    // Here you would save booking info to DB (not implemented yet)
    req.flash('success', 'Successfully booked!');
    res.redirect(`/listings/${req.params.id}`);
});

//create route
app.post("/listings",
    wrapAsync(async (req, res, next) => {
        const newListing = new Listing(req.body.listing);
        await newListing.save();
        res.redirect("/listings");
    })
);

//Edit route
app.get("/listings/:id/edit", wrapAsync(async (req, res) => {
    let { id } = req.params;
    const listing = await Listing.findById(id);
    res.render("listings/edit", { listing });
}));

//Update Route
app.put("/listings/:id",
    wrapAsync(async (req, res) => {
        let { id } = req.params;
        await Listing.findByIdAndUpdate(id, { ...req.body.listing });
        res.redirect(`/listings/${id}`);
    }));

//Delete Route
app.delete("/listings/:id", wrapAsync(async (req, res) => {
    let { id } = req.params;
    let deletedListing = await Listing.findByIdAndDelete(id);
    console.log(deletedListing);
    res.redirect("/listings");
}));

//Reviews
//Post Review route
app.post("/listings/:id/reviews",
    validateReview,
    wrapAsync(async (req, res) => {
    let listing = await Listing.findById(req.params.id);
        let reviewData = req.body.review;
        if (req.user) {
            reviewData.author = req.user.username;
        } else {
            reviewData.author = reviewData.author || "Anonymous";
        }
    let newReview = new Review(reviewData);

    listing.reviews.push(newReview);

    await newReview.save();
    await listing.save();

    res.redirect(`/listings/${listing._id}`);
    }));

//Delete review Route
app.delete(
    "/listings/:id/reviews/:reviewId",
    wrapAsync(async (req, res) => {
        let { id, reviewId } = req.params;

        await Review.findByIdAndDelete(reviewId);
        await Listing.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });
        
        res.redirect(`/listings/${id}`);
    })
);

// Catch-all for 404s
app.use((req, res, next) => {
    next(new ExpressError(404, "Page Not Found!"));
});

// Error handler
app.use((err, req, res, next) => {
    const { statusCode = 500, message = "Something went wrong!" } = err;
    res.status(statusCode).render("error.ejs", { message });
    // res.status(statusCode).send(message);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`server is listening on port ${PORT}`);
});
