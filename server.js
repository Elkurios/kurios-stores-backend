/* =========================================================
   KURIOS STORES
   MAIN JAVASCRIPT
   ========================================================= */


/* =========================================================
   1. BASIC SETTINGS
   ========================================================= */

/*
    This is the address of our Node.js backend.

    Our frontend is here:

    C:\Users\HomePC\Desktop\CODE WITH ELKURIOS\kurios-stores

    Our backend is here:

    C:\Users\HomePC\Desktop\kurios-stores-backend
*/

const API_URL = "https://kurios-stores-backend.onrender.com";


/*
    Wait until the HTML has completely loaded
    before JavaScript starts working.
*/

document.addEventListener("DOMContentLoaded", function () {


    console.log("Kurios Stores website loaded successfully.");



    /* =====================================================
       2. GET IMPORTANT HTML ELEMENTS
       ===================================================== */


    const productGrid =
        document.getElementById("productGrid");


    const cartButton =
        document.getElementById("cartButton");


    const cartOverlay =
        document.getElementById("cartOverlay");


    const closeCart =
        document.getElementById("closeCart");


    const cartItems =
        document.getElementById("cartItems");


    const cartCount =
        document.getElementById("cartCount");


    const cartTotal =
        document.getElementById("cartTotal");


    const checkoutButton =
        document.getElementById("checkoutButton");



    /* =====================================================
       3. SHOPPING CART
       ===================================================== */


    /*
        The cart is stored in this array.

        Example:

        [
            {
                id: 1,
                name: "Instant Noodles",
                price: 1200,
                quantity: 2
            }
        ]
    */

    let cart = JSON.parse(
        localStorage.getItem("kuriosCart")
    ) || [];



    /*
        Save the cart in the browser.

        This means refreshing the page
        won't immediately empty the cart.
    */

    function saveCart() {

        localStorage.setItem(
            "kuriosCart",
            JSON.stringify(cart)
        );

    }



    /*
        Format Nigerian currency.
    */

    function formatMoney(amount) {

        return "₦" + Number(amount).toLocaleString();

    }



    /* =====================================================
       4. DISPLAY CART
       ===================================================== */


    function updateCart() {


        /*
            Make sure the cart container exists.
        */

        if (!cartItems) {
            return;
        }


        /*
            Empty the current cart display.
        */

        cartItems.innerHTML = "";



        /*
            If there are no products...
        */

        if (cart.length === 0) {

            cartItems.innerHTML = `

                <div class="empty-cart">

                    <i class="fa-solid fa-cart-shopping"></i>

                    <h3>
                        Your cart is empty
                    </h3>

                    <p>
                        Add some products to get started.
                    </p>

                </div>

            `;

        }



        /*
            Otherwise display the products.
        */

        else {

            cart.forEach(function (item, index) {


                const itemTotal =
                    item.price * item.quantity;


                cartItems.innerHTML += `

                    <div class="cart-item">


                        <div class="cart-item-image">

                            <i class="fa-solid fa-bag-shopping"></i>

                        </div>



                        <div class="cart-item-info">

                            <h3>
                                ${item.name}
                            </h3>


                            <div class="cart-item-price">

                                ${formatMoney(item.price)}

                            </div>



                            <div class="quantity-controls">


                                <button
                                    class="quantity-button"
                                    data-action="decrease"
                                    data-index="${index}"
                                >
                                    −
                                </button>


                                <strong>
                                    ${item.quantity}
                                </strong>


                                <button
                                    class="quantity-button"
                                    data-action="increase"
                                    data-index="${index}"
                                >
                                    +
                                </button>


                                <button
                                    class="remove-item"
                                    data-action="remove"
                                    data-index="${index}"
                                >
                                    Remove
                                </button>


                            </div>


                        </div>



                        <strong>

                            ${formatMoney(itemTotal)}

                        </strong>


                    </div>

                `;

            });

        }



        /*
            Calculate total number of items.
        */

        let totalQuantity = 0;


        cart.forEach(function (item) {

            totalQuantity += item.quantity;

        });



        /*
            Update cart badge.
        */

        if (cartCount) {

            cartCount.textContent =
                totalQuantity;

        }



        /*
            Calculate total price.
        */

        let totalPrice = 0;


        cart.forEach(function (item) {

            totalPrice +=
                item.price * item.quantity;

        });



        /*
            Display total price.
        */

        if (cartTotal) {

            cartTotal.textContent =
                formatMoney(totalPrice);

        }

    }



    /* =====================================================
       5. ADD PRODUCT TO CART
       ===================================================== */


    function addToCart(product) {


        /*
            Check whether the product
            already exists in the cart.
        */

        const existingProduct =
            cart.find(function (item) {

                return item.id === product.id;

            });



        /*
            If it already exists,
            increase quantity.
        */

        if (existingProduct) {

            existingProduct.quantity += 1;

        }



        /*
            Otherwise add a new product.
        */

        else {

            cart.push({

                id: product.id,

                name: product.name,

                price: Number(product.price),

                quantity: 1

            });

        }



        /*
            Save cart.
        */

        saveCart();


        /*
            Update display.
        */

        updateCart();


        /*
            Open cart.
        */

        openCart();


        /*
            Show confirmation.
        */

        showMessage(
            product.name + " added to your cart."
        );

    }



    /* =====================================================
       6. CART BUTTON
       ===================================================== */


    function openCart() {

        if (cartOverlay) {

            cartOverlay.classList.add("open");

        }

    }



    function closeCartPanel() {

        if (cartOverlay) {

            cartOverlay.classList.remove("open");

        }

    }



    if (cartButton) {

        cartButton.addEventListener(
            "click",
            openCart
        );

    }



    if (closeCart) {

        closeCart.addEventListener(
            "click",
            closeCartPanel
        );

    }



    /*
        Clicking outside the cart
        closes it.
    */

    if (cartOverlay) {

        cartOverlay.addEventListener(
            "click",
            function (event) {

                if (
                    event.target === cartOverlay
                ) {

                    closeCartPanel();

                }

            }
        );

    }



    /* =====================================================
       7. CART QUANTITY BUTTONS
       ===================================================== */


    if (cartItems) {

        cartItems.addEventListener(
            "click",
            function (event) {


                const button =
                    event.target.closest("button");


                if (!button) {
                    return;
                }


                const action =
                    button.dataset.action;


                const index =
                    Number(button.dataset.index);



                /*
                    Increase quantity.
                */

                if (action === "increase") {

                    cart[index].quantity += 1;

                }



                /*
                    Decrease quantity.
                */

                if (action === "decrease") {

                    cart[index].quantity -= 1;


                    /*
                        Remove product when
                        quantity reaches zero.
                    */

                    if (
                        cart[index].quantity <= 0
                    ) {

                        cart.splice(index, 1);

                    }

                }



                /*
                    Remove product.
                */

                if (action === "remove") {

                    cart.splice(index, 1);

                }



                saveCart();

                updateCart();

            }
        );

    }



    /* =====================================================
       8. LOAD PRODUCTS FROM NODE BACKEND
       ===================================================== */


    async function loadProducts() {


        /*
            Tell the browser:

            "Go to my backend and
             ask for the products."
        */

        try {


            const response =
                await fetch(
                    API_URL + "/api/products"
                );



            /*
                Check whether the backend
                responded successfully.
            */

            if (!response.ok) {

                throw new Error(
                    "Backend returned an error."
                );

            }



            /*
                Convert the response
                into JavaScript data.
            */

            const products =
                await response.json();



            console.log(
                "Products from Kurios Backend:",
                products
            );



            /*
                Display products
                on the website.
            */

            displayProducts(products);


        }


        catch (error) {


            console.error(
                "Error connecting to backend:",
                error
            );



            /*
                Tell the user that
                the backend isn't available.
            */

            if (productGrid) {

                productGrid.innerHTML = `

                    <div class="empty-state">

                        <i class="fa-solid fa-triangle-exclamation"></i>

                        <h3>
                            Products could not be loaded
                        </h3>

                        <p>
                            Please make sure the Kurios Stores
                            backend is running.
                        </p>

                    </div>

                `;

            }

        }

    }



    /* =====================================================
       9. DISPLAY PRODUCTS
       ===================================================== */


    function displayProducts(products) {


        if (!productGrid) {
            return;
        }


        /*
            Remove the old hard-coded products.
        */

        productGrid.innerHTML = "";



        /*
            If there are no products.
        */

        if (
            !products ||
            products.length === 0
        ) {

            productGrid.innerHTML = `

                <div class="empty-state">

                    <i class="fa-solid fa-box-open"></i>

                    <h3>
                        No products available
                    </h3>

                    <p>
                        Please check back later.
                    </p>

                </div>

            `;

            return;

        }



        /*
            Go through each product.
        */

        products.forEach(function (product) {


            /*
                Determine a category
                for our current test products.
            */

            let category = "Food";

            let icon =
                "fa-utensils";


            if (
                product.name
                    .toLowerCase()
                    .includes("water")
            ) {

                category = "Food";

                icon =
                    "fa-bottle-water";

            }


            else if (
                product.name
                    .toLowerCase()
                    .includes("noodle")
            ) {

                category = "Food";

                icon =
                    "fa-bowl-food";

            }


            else if (
                product.name
                    .toLowerCase()
                    .includes("biscuit")
            ) {

                category = "Food";

                icon =
                    "fa-cookie-bite";

            }



            /*
                Create the product card.
            */

            const productCard =
                document.createElement("article");


            productCard.className =
                "product-card";


            productCard.dataset.category =
                category;



            productCard.innerHTML = `

                <div class="product-image">

                    <i class="fa-solid ${icon}"></i>

                </div>


                <div class="product-info">


                    <span class="product-category">

                        ${category}

                    </span>


                    <h3>

                        ${product.name}

                    </h3>


                    <p>

                        Available at
                        Kurios Stores.

                    </p>


                    <div class="product-bottom">


                        <strong>

                            ${formatMoney(product.price)}

                        </strong>


                        <button

                            class="add-to-cart"

                            data-product-id="${product.id}"

                        >

                            <i class="fa-solid fa-plus"></i>

                            Add

                        </button>


                    </div>


                </div>

            `;



            /*
                Put the card inside
                the product grid.
            */

            productGrid.appendChild(
                productCard
            );



            /*
                Add click event to
                the Add button.
            */

            const addButton =
                productCard.querySelector(
                    ".add-to-cart"
                );


            addButton.addEventListener(
                "click",
                function () {

                    addToCart(product);

                }
            );

        });

    }



    /* =====================================================
       10. PRODUCT FILTERS
       ===================================================== */


    const filterButtons =
        document.querySelectorAll(
            ".filter-button"
        );



    filterButtons.forEach(
        function (button) {


            button.addEventListener(
                "click",
                function () {


                    /*
                        Remove active state
                        from all buttons.
                    */

                    filterButtons.forEach(
                        function (item) {

                            item.classList.remove(
                                "active"
                            );

                        }
                    );



                    /*
                        Activate clicked button.
                    */

                    button.classList.add(
                        "active"
                    );



                    const selectedCategory =
                        button.dataset.filter;



                    const productCards =
                        document.querySelectorAll(
                            ".product-card"
                        );



                    productCards.forEach(
                        function (card) {


                            if (
                                selectedCategory ===
                                "all"
                            ) {

                                card.style.display =
                                    "";

                                return;

                            }



                            if (
                                card.dataset.category ===
                                selectedCategory
                            ) {

                                card.style.display =
                                    "";

                            }

                            else {

                                card.style.display =
                                    "none";

                            }

                        }
                    );

                }
            );

        }
    );



    /* =====================================================
       11. CATEGORY CARDS
       ===================================================== */


    const categoryCards =
        document.querySelectorAll(
            ".category-card"
        );


    categoryCards.forEach(
        function (card) {

            card.addEventListener(
                "click",
                function () {


                    const category =
                        card.dataset.category;


                    /*
                        Find matching shop filter.
                    */

                    const filter =
                        document.querySelector(
                            `.filter-button[data-filter="${category}"]`
                        );


                    if (filter) {

                        filter.click();

                    }


                    /*
                        Scroll to shop.
                    */

                    const shop =
                        document.getElementById(
                            "shop"
                        );


                    if (shop) {

                        shop.scrollIntoView({
                            behavior: "smooth"
                        });

                    }

                }
            );

        }
    );

// ========================================
// UPDATE HEADER LOGIN STATE
// ========================================

function updateLoginState() {

        // ========================================
    // HERO LOGIN STATE
    // ========================================

    const loggedOutHero =
        document.getElementById("loggedOutHero");

    const loggedInHero =
        document.getElementById("loggedInHero");

    const heroStudentName =
        document.getElementById("heroStudentName");

    const heroStudentCampus =
        document.getElementById("heroStudentCampus");

    const signInButton =
        document.getElementById("openSignIn");

    if (!signInButton) {
        return;
    }


    // ========================================
    // GET LOGGED-IN STUDENT
    // ========================================

    let storedStudent =
        localStorage.getItem("kuriosLoggedInStudent");

    if (!storedStudent) {

        storedStudent =
            sessionStorage.getItem(
                "kuriosLoggedInStudent"
            );

    }


    // ========================================
    // STUDENT IS NOT LOGGED IN
    // ========================================

    if (!storedStudent) {

    signInButton.innerHTML = `
        <i class="fa-regular fa-user"></i>

        <span>
            Sign In
        </span>
    `;


    // ========================================
    // SHOW LOGGED-OUT HERO
    // ========================================

    const loggedOutHero =
        document.getElementById("loggedOutHero");

    const loggedInHero =
        document.getElementById("loggedInHero");


    if (loggedOutHero) {

        loggedOutHero.style.display =
            "block";

    }


    if (loggedInHero) {

        loggedInHero.style.display =
            "none";

    }


    return;

}


    // ========================================
    // READ STUDENT DATA
    // ========================================

    let student;

    try {

        student =
            JSON.parse(storedStudent);

    } catch (error) {

        console.error(
            "Unable to read logged-in student:",
            error
        );

        return;

    }


    // ========================================
    // UPDATE HERO FOR LOGGED-IN STUDENT
    // ========================================


    // ========================================
    // HIDE LOGGED-OUT HERO
    // ========================================

    if (loggedOutHero) {

        loggedOutHero.style.display =
            "none";

    }

    // ========================================
    // SHOW LOGGED-IN HERO
    // ========================================

    if (loggedInHero) {

        loggedInHero.style.display =
            "block";

    }


    // ========================================
    // STUDENT NAME
    // ========================================

    if (heroStudentName) {

        heroStudentName.textContent =
            student.first_name ||
            student.firstName ||
            "Student";

    }


    // ========================================
    // STUDENT INFORMATION
    // ========================================

    if (heroStudentCampus) {

        const university =
            student.university ||
            "";

        const studentId =
            student.student_id ||
            student.studentId ||
            "";


        if (university) {

            heroStudentCampus.textContent =
                university;

        } else if (studentId) {

            heroStudentCampus.textContent =
                studentId;

        } else {

            heroStudentCampus.textContent =
                "Your campus";

        }

    }


    // ========================================
    // ACTIVE ORDERS
    // ========================================

    refreshOrderCountBadge(student.id);


    // ========================================
    // GET DISPLAY NAME
    // ========================================

    const firstName =
        student.first_name || "";

    const lastName =
        student.last_name || "";

    const displayName =
        firstName ||
        lastName ||
        "Account";


    // ========================================
    // UPDATE HEADER
    // ========================================

    signInButton.innerHTML = `
        <i class="fa-regular fa-user"></i>

        <span>
            ${displayName}
        </span>
    `;

}

// ========================================
// CHECK LOGIN STATE
// ========================================

updateLoginState();

    /* =====================================================
       12. SIGN IN MODAL
       ===================================================== */


    const openSignIn =
        document.getElementById(
            "openSignIn"
        );


    const signInModal =
        document.getElementById(
            "signInModal"
        );


    const closeSignIn =
        document.getElementById(
            "closeSignIn"
        );


    const signInForm =
        document.getElementById(
            "signinForm"
        );



    function openSignInModal() {

        if (signInModal) {

            signInModal.classList.add(
                "open"
            );

        }

    }



    function closeSignInModal() {

        if (signInModal) {

            signInModal.classList.remove(
                "open"
            );

        }

    }



    // ========================================
// STUDENT ACCOUNT / SIGN IN BUTTON
// ========================================

const studentAccountMenu =
    document.getElementById(
        "studentAccountMenu"
    );


if (openSignIn) {

    openSignIn.addEventListener(
        "click",
        function (event) {

            event.stopPropagation();


            // ========================================
            // CHECK LOGIN STATE
            // ========================================

            const loggedInStudent =
                localStorage.getItem(
                    "kuriosLoggedInStudent"
                ) ||
                sessionStorage.getItem(
                    "kuriosLoggedInStudent"
                );


            // ========================================
            // NOT LOGGED IN
            // ========================================

            if (!loggedInStudent) {

                if (studentAccountMenu) {

                    studentAccountMenu.classList.remove(
                        "open"
                    );

                }

                openSignInModal();

                return;

            }


            // ========================================
            // LOGGED IN
            // ========================================

            if (studentAccountMenu) {

                studentAccountMenu.classList.toggle(
                    "open"
                );

            }

        }
    );

}


// ========================================
// CLOSE ACCOUNT MENU WHEN CLICKING OUTSIDE
// ========================================

document.addEventListener(
    "click",
    function (event) {

        if (!studentAccountMenu) {
            return;
        }


        if (
            !studentAccountMenu.contains(event.target) &&
            event.target !== openSignIn &&
            !openSignIn.contains(event.target)
        ) {

            studentAccountMenu.classList.remove(
                "open"
            );

        }

    }
);

// ========================================
// GET CURRENTLY LOGGED-IN STUDENT
// ========================================

function getLoggedInStudent() {

    const storedStudent =
        localStorage.getItem(
            "kuriosLoggedInStudent"
        ) ||
        sessionStorage.getItem(
            "kuriosLoggedInStudent"
        );

    if (!storedStudent) {
        return null;
    }

    try {

        return JSON.parse(storedStudent);

    } catch (error) {

        console.error(
            "Unable to read logged-in student:",
            error
        );

        return null;

    }

}


// ========================================
// SAVE AN UPDATED STUDENT OBJECT BACK TO
// WHICHEVER STORAGE IT CAME FROM
// ========================================

function saveLoggedInStudent(student) {

    const studentJson =
        JSON.stringify(student);

    if (
        localStorage.getItem("kuriosLoggedInStudent")
    ) {

        localStorage.setItem(
            "kuriosLoggedInStudent",
            studentJson
        );

    } else {

        sessionStorage.setItem(
            "kuriosLoggedInStudent",
            studentJson
        );

    }

}


// ========================================
// MY PROFILE PANEL
// ========================================

const accountProfile =
    document.getElementById("accountProfile");

const profileOverlay =
    document.getElementById("profileOverlay");

const profilePanel =
    document.getElementById("profilePanel");

const closeProfile =
    document.getElementById("closeProfile");

const editProfileButton =
    document.getElementById("editProfileButton");

const cancelProfileEdit =
    document.getElementById("cancelProfileEdit");

const saveProfileEdit =
    document.getElementById("saveProfileEdit");

const profilePhoneInput =
    document.getElementById("profilePhoneInput");

const profileDobInput =
    document.getElementById("profileDobInput");

const profilePictureInput =
    document.getElementById("profilePictureInput");

const profileAvatarCircle =
    document.getElementById("profileAvatarCircle");

const profileAvatarEditBadge =
    document.getElementById("profileAvatarEditBadge");


// Holds the file the student just picked,
// until they hit Save.

let selectedProfilePictureFile = null;


// ========================================
// SHOW A STUDENT'S DATA IN THE PANEL
// (view mode fields)
// ========================================

function renderProfilePanel(student) {

    // FULL NAME

    const fullNameEl =
        document.getElementById("profileFullName");

    if (fullNameEl) {

        const firstName =
            student.first_name ||
            student.firstName ||
            "";

        const lastName =
            student.last_name ||
            student.lastName ||
            "";

        const fullName =
            `${firstName} ${lastName}`.trim();

        fullNameEl.textContent =
            fullName ||
            "Student";

    }


    // STUDENT ID

    const studentIdEl =
        document.getElementById("profileStudentId");

    if (studentIdEl) {

        studentIdEl.textContent =
            student.student_id ||
            student.studentId ||
            "Not provided";

    }


    // UNIVERSITY

    const universityEl =
        document.getElementById("profileUniversity");

    if (universityEl) {

        universityEl.textContent =
            student.university ||
            "Not provided";

    }


    // EMAIL

    const emailEl =
        document.getElementById("profileEmail");

    if (emailEl) {

        emailEl.textContent =
            student.email ||
            "Not provided";

    }


    // PHONE NUMBER

    const phoneEl =
        document.getElementById("profilePhone");

    if (phoneEl) {

        phoneEl.textContent =
            student.phone ||
            "Not provided";

    }

    if (profilePhoneInput) {

        profilePhoneInput.value =
            student.phone ||
            "";

    }


    // DATE OF BIRTH

    const dobEl =
        document.getElementById("profileDob");

    const dobRaw =
        student.date_of_birth ||
        student.dob ||
        null;

    // The database sends this back as a full
    // timestamp — we only want the date part,
    // both for display and for the date input.

    const dobShort =
        dobRaw ?
            dobRaw.slice(0, 10) :
            null;

    if (dobEl) {

        dobEl.textContent =
            dobShort ||
            "Not provided";

    }

    if (profileDobInput) {

        profileDobInput.value =
            dobShort ||
            "";

    }


    // ACCOUNT STATUS

    const statusEl =
        document.getElementById("profileAccountStatus");

    if (statusEl) {

        statusEl.textContent =
            student.email_verified === false ?
                "Unverified" :
                "Active";

    }


    // PROFILE PICTURE

    renderProfileAvatar(
        student.profile_picture
    );

}


// ========================================
// SHOW THE AVATAR — PICTURE IF THERE IS ONE,
// OTHERWISE THE PLAIN PERSON ICON
// ========================================

function renderProfileAvatar(profilePicturePath) {

    if (!profileAvatarCircle) {
        return;
    }


    const existingImg =
        profileAvatarCircle.querySelector("img");

    if (existingImg) {
        existingImg.remove();
    }


    if (profilePicturePath) {

        const img =
            document.createElement("img");

        img.src =
            API_URL + profilePicturePath;

        img.alt =
            "Profile picture";

        profileAvatarCircle.insertBefore(
            img,
            profileAvatarCircle.firstChild
        );

    }

}


// ========================================
// OPEN THE PANEL
// ========================================

function openProfilePanel() {

    const student =
        getLoggedInStudent();


    // NOT LOGGED IN — SEND TO SIGN IN INSTEAD

    if (!student) {

        if (studentAccountMenu) {

            studentAccountMenu.classList.remove(
                "open"
            );

        }

        openSignInModal();

        return;

    }


    renderProfilePanel(student);
    exitProfileEditMode();


    if (studentAccountMenu) {

        studentAccountMenu.classList.remove(
            "open"
        );

    }

    if (profileOverlay) {

        profileOverlay.classList.add(
            "open"
        );

    }

}


function closeProfilePanel() {

    if (profileOverlay) {

        profileOverlay.classList.remove(
            "open"
        );

    }

    exitProfileEditMode();

}


// ========================================
// ENTER / EXIT EDIT MODE
// ========================================

function enterProfileEditMode() {

    if (profilePanel) {

        profilePanel.classList.add(
            "editing"
        );

    }

}


function exitProfileEditMode() {

    if (profilePanel) {

        profilePanel.classList.remove(
            "editing"
        );

    }


    // Undo any unsaved picture preview and
    // clear the picked file.

    selectedProfilePictureFile = null;

    if (profilePictureInput) {

        profilePictureInput.value = "";

    }

    const student =
        getLoggedInStudent();

    if (student) {

        renderProfileAvatar(
            student.profile_picture
        );

    }

}


// ========================================
// PICK A NEW PROFILE PICTURE
// ========================================

if (profileAvatarEditBadge) {

    profileAvatarEditBadge.addEventListener(
        "click",
        function () {

            if (profilePictureInput) {

                profilePictureInput.click();

            }

        }
    );

}


if (profilePictureInput) {

    profilePictureInput.addEventListener(
        "change",
        function () {

            const file =
                profilePictureInput.files[0];

            if (!file) {
                return;
            }


            selectedProfilePictureFile =
                file;


            // Instant local preview before saving.

            const reader =
                new FileReader();

            reader.onload = function () {

                if (!profileAvatarCircle) {
                    return;
                }

                const existingImg =
                    profileAvatarCircle.querySelector("img");

                if (existingImg) {
                    existingImg.remove();
                }

                const img =
                    document.createElement("img");

                img.src =
                    reader.result;

                img.alt =
                    "Profile picture preview";

                profileAvatarCircle.insertBefore(
                    img,
                    profileAvatarCircle.firstChild
                );

            };

            reader.readAsDataURL(file);

        }
    );

}


// ========================================
// SAVE PROFILE CHANGES
// ========================================

if (saveProfileEdit) {

    saveProfileEdit.addEventListener(
        "click",
        async function () {

            const student =
                getLoggedInStudent();

            if (!student) {
                return;
            }


            const formData =
                new FormData();

            formData.append(
                "studentId",
                student.id
            );

            if (profilePhoneInput) {

                formData.append(
                    "phone",
                    profilePhoneInput.value.trim()
                );

            }

            if (profileDobInput && profileDobInput.value) {

                formData.append(
                    "dateOfBirth",
                    profileDobInput.value
                );

            }

            if (selectedProfilePictureFile) {

                formData.append(
                    "profilePicture",
                    selectedProfilePictureFile
                );

            }


            saveProfileEdit.disabled = true;

            saveProfileEdit.textContent =
                "Saving...";


            try {

                const response =
                    await fetch(
                        API_URL + "/api/students/update-profile",
                        {
                            method: "POST",
                            body: formData
                        }
                    );

                const data =
                    await response.json();


                if (!data.success) {

                    showMessage(
                        data.message ||
                        "Could not update your profile."
                    );

                    return;

                }


                // Merge the returned fields into the
                // stored student so nothing already
                // held (like the password-free login
                // fields) gets lost.

                const updatedStudent =
                    Object.assign(
                        {},
                        student,
                        data.student
                    );

                saveLoggedInStudent(
                    updatedStudent
                );

                renderProfilePanel(
                    updatedStudent
                );

                exitProfileEditMode();

                showMessage(
                    "Profile updated successfully."
                );

            } catch (error) {

                console.error(
                    "Profile update error:",
                    error
                );

                showMessage(
                    "Could not reach the server. Please try again."
                );

            } finally {

                saveProfileEdit.disabled = false;

                saveProfileEdit.textContent =
                    "Save Changes";

            }

        }
    );

}


if (editProfileButton) {

    editProfileButton.addEventListener(
        "click",
        enterProfileEditMode
    );

}


if (cancelProfileEdit) {

    cancelProfileEdit.addEventListener(
        "click",
        function () {

            const student =
                getLoggedInStudent();

            if (student) {

                renderProfilePanel(
                    student
                );

            }

            exitProfileEditMode();

        }
    );

}


if (accountProfile) {

    accountProfile.addEventListener(
        "click",
        openProfilePanel
    );

}


if (closeProfile) {

    closeProfile.addEventListener(
        "click",
        closeProfilePanel
    );

}


// Clicking outside the profile panel closes it.

if (profileOverlay) {

    profileOverlay.addEventListener(
        "click",
        function (event) {

            if (
                event.target === profileOverlay
            ) {

                closeProfilePanel();

            }

        }
    );

}


// ========================================
// MY ORDERS PANEL
// ========================================

const accountOrders =
    document.getElementById("accountOrders");

const dashboardMyOrders =
    document.getElementById("dashboardMyOrders");

const ordersOverlay =
    document.getElementById("ordersOverlay");

const closeOrders =
    document.getElementById("closeOrders");

const ordersPanelBody =
    document.getElementById("ordersPanelBody");


const ORDERS_EMPTY_STATE_HTML = `
    <div class="empty-cart">
        <i class="fa-solid fa-box"></i>
        <h3>No orders yet</h3>
        <p>Your past orders will show up here once you check out.</p>
    </div>
`;


function formatOrderDate(dateString) {

    const date =
        new Date(dateString);

    if (isNaN(date.getTime())) {
        return "";
    }

    return date.toLocaleDateString(
        "en-NG",
        {
            day: "numeric",
            month: "short",
            year: "numeric"
        }
    );

}


function renderOrderCard(order) {

    const statusClass =
        "status-" + order.status;

    const statusLabel =
        order.status.charAt(0).toUpperCase() +
        order.status.slice(1);

    const itemRows =
        order.items.map(function (item) {

            return `
                <div class="order-card-item-row">
                    <span>${item.name} × ${item.quantity}</span>
                    <span>${formatMoney(item.price * item.quantity)}</span>
                </div>
            `;

        }).join("");

    return `
        <div class="order-card">

            <div class="order-card-top">

                <div>
                    <div class="order-card-reference">
                        ${order.payment_reference}
                    </div>
                    <div class="order-card-date">
                        ${formatOrderDate(order.created_at)}
                    </div>
                </div>

                <span class="order-status-badge ${statusClass}">
                    ${statusLabel}
                </span>

            </div>

            <div class="order-card-items">
                ${itemRows}
            </div>

            <div class="order-card-total">
                <span>Total</span>
                <strong>${formatMoney(order.amount)}</strong>
            </div>

        </div>
    `;

}


async function loadOrdersIntoPanel(studentId) {

    if (!ordersPanelBody) {
        return;
    }

    ordersPanelBody.innerHTML = `
        <div class="empty-cart">
            <i class="fa-solid fa-spinner"></i>
            <h3>Loading your orders...</h3>
        </div>
    `;

    try {

        const response =
            await fetch(
                API_URL + "/api/orders?studentId=" + studentId
            );

        const data =
            await response.json();

        if (!data.success) {

            ordersPanelBody.innerHTML = `
                <div class="empty-cart">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <h3>Could not load your orders</h3>
                    <p>${data.message || "Please try again."}</p>
                </div>
            `;

            return;

        }

        if (data.orders.length === 0) {

            ordersPanelBody.innerHTML =
                ORDERS_EMPTY_STATE_HTML;

            return;

        }

        ordersPanelBody.innerHTML =
            data.orders.map(renderOrderCard).join("");

    } catch (error) {

        console.error(
            "Load orders error:",
            error
        );

        ordersPanelBody.innerHTML = `
            <div class="empty-cart">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <h3>Could not reach the server</h3>
                <p>Please try again.</p>
            </div>
        `;

    }

}


function openOrdersPanel() {

    const student =
        getLoggedInStudent();

    if (!student) {

        if (studentAccountMenu) {

            studentAccountMenu.classList.remove(
                "open"
            );

        }

        openSignInModal();

        return;

    }

    if (studentAccountMenu) {

        studentAccountMenu.classList.remove(
            "open"
        );

    }

    if (ordersOverlay) {

        ordersOverlay.classList.add(
            "open"
        );

    }

    loadOrdersIntoPanel(
        student.id
    );

}


function closeOrdersPanel() {

    if (ordersOverlay) {

        ordersOverlay.classList.remove(
            "open"
        );

    }

}


// ========================================
// KEEP THE HERO'S ORDER COUNT ACCURATE
// ("active" = paid, not yet fulfilled)
// ========================================

async function refreshOrderCountBadge(studentId) {

    const heroActiveOrdersEl =
        document.getElementById("heroActiveOrders");

    const heroOrdersBadgeEl =
        document.getElementById("heroOrdersBadge");

    if (!heroActiveOrdersEl || !heroOrdersBadgeEl) {
        return;
    }

    try {

        const response =
            await fetch(
                API_URL + "/api/orders?studentId=" + studentId
            );

        const data =
            await response.json();

        if (!data.success) {
            return;
        }

        const activeOrderCount =
            data.orders.filter(function (order) {

                return order.status === "paid";

            }).length;

        heroActiveOrdersEl.textContent =
            `${activeOrderCount} active order${activeOrderCount === 1 ? "" : "s"}`;

        heroOrdersBadgeEl.textContent =
            activeOrderCount;

    } catch (error) {

        console.error(
            "Order count refresh error:",
            error
        );

    }

}


if (accountOrders) {

    accountOrders.addEventListener(
        "click",
        openOrdersPanel
    );

}


if (dashboardMyOrders) {

    dashboardMyOrders.addEventListener(
        "click",
        openOrdersPanel
    );

}


if (closeOrders) {

    closeOrders.addEventListener(
        "click",
        closeOrdersPanel
    );

}


if (ordersOverlay) {

    ordersOverlay.addEventListener(
        "click",
        function (event) {

            if (
                event.target === ordersOverlay
            ) {

                closeOrdersPanel();

            }

        }
    );

}




    if (closeSignIn) {

        closeSignIn.addEventListener(
            "click",
            closeSignInModal
        );

    }



    if (signInModal) {

        signInModal.addEventListener(
            "click",
            function (event) {

                if (
                    event.target ===
                    signInModal
                ) {

                    closeSignInModal();

                }

            }
        );

    }



    /*
        Current sign-in is still
        a frontend demonstration.

        REAL authentication will be
        connected to PostgreSQL later.
    */

    // ========================================
// STUDENT SIGN IN
// ========================================

if (signInForm) {

    signInForm.addEventListener(
        "submit",
        async function (event) {

            event.preventDefault();


            // ========================================
            // GET FORM VALUES
            // ========================================

            const email =
                document.getElementById(
                    "signinEmail"
                ).value.trim();

            const password =
                document.getElementById(
                    "signinPassword"
                ).value;


            // ========================================
            // VALIDATE INPUT
            // ========================================

            if (
                email === "" ||
                password === ""
            ) {

                showMessage(
                    "Please fill in all fields."
                );

                return;

            }


            // ========================================
            // GET SIGN IN BUTTON
            // ========================================

            const signInButton =
                signInForm.querySelector(
                    'button[type="submit"]'
                );


            // ========================================
            // DISABLE BUTTON
            // ========================================

            if (signInButton) {

                signInButton.disabled = true;

                signInButton.innerHTML = `
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    Signing In...
                `;

            }


            try {

                // ========================================
                // SEND LOGIN REQUEST
                // ========================================

                const response =
                    await fetch(
                        API_URL + "/api/students/login",
                        {

                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({

                                email:
                                    email,

                                password:
                                    password

                            })

                        }
                    );


                // ========================================
                // READ RESPONSE
                // ========================================

                const data =
                    await response.json();


                // ========================================
                // LOGIN FAILED
                // ========================================

                if (
                    !response.ok ||
                    !data.success
                ) {

                    showMessage(
                        data.message ||
                        "Invalid email or password."
                    );

                    return;

                }


                // ========================================
                // LOGIN SUCCESSFUL
                // ========================================

                console.log(
                    "Student logged in successfully:",
                    data.student
                );


                // ========================================
                // SAVE LOGGED-IN STUDENT
                // ========================================

                const rememberMe =
                    document.getElementById(
                        "rememberMe"
                    );


                if (
                    rememberMe &&
                    rememberMe.checked
                ) {

                    localStorage.setItem(
                        "kuriosLoggedInStudent",
                        JSON.stringify(
                            data.student
                        )
                    );

                } else {

                    sessionStorage.setItem(
                        "kuriosLoggedInStudent",
                        JSON.stringify(
                            data.student
                        )
                    );

                }


                // ========================================
                // SUCCESS MESSAGE
                // ========================================

                showMessage(
                    "Login successful. Welcome back to Kurios Stores."
                );

updateLoginState();





                // ========================================
                // CLOSE SIGN-IN MODAL
                // ========================================

                const signInModal =
                    document.getElementById(
                        "signInModal"
                    );

                if (signInModal) {

                    signInModal.classList.remove(
                        "open"
                    );

                }


                // ========================================
                // CLEAR PASSWORD
                // ========================================

                const passwordInput =
                    document.getElementById(
                        "signinPassword"
                    );

                if (passwordInput) {

                    passwordInput.value = "";

                }


                // ========================================
                // UPDATE UI
                // ========================================

                console.log(
                    "Logged-in student:",
                    data.student
                );


            } catch (error) {

                console.error(
                    "Sign-in error:",
                    error
                );


                showMessage(
                    "Unable to connect to Kurios Stores server."
                );


            } finally {

                // ========================================
                // RESTORE BUTTON
                // ========================================

                if (signInButton) {

                    signInButton.disabled = false;

                    signInButton.innerHTML = `
                        Sign In
                    `;

                }

            }

        }
    );

}



    /* =====================================================
       13. SIGN UP MODAL
       ===================================================== */


    const signUpModal =
        document.getElementById(
            "signUpModal"
        );


    const openSignUp =
        document.getElementById(
            "openSignUp"
        );


    const closeSignUp =
        document.getElementById(
            "closeSignUp"
        );


    const signupForm =
        document.getElementById(
            "signupForm"
        );


    const backToSignIn =
        document.getElementById(
            "backToSignIn"
        );



    function openSignUpModal() {

        if (signInModal) {

            signInModal.classList.remove(
                "active"
            );

        }


        if (signUpModal) {

            signUpModal.classList.add(
                "active"
            );

        }

    }



    function closeSignUpModal() {

        if (signUpModal) {

            signUpModal.classList.remove(
                "active"
            );

        }

    }



    if (openSignUp) {

        openSignUp.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                openSignUpModal();

            }
        );

    }



    if (closeSignUp) {

        closeSignUp.addEventListener(
            "click",
            closeSignUpModal
        );

    }



    if (backToSignIn) {

        backToSignIn.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                closeSignUpModal();

                openSignInModal();

            }
        );

    }



    if (signupForm) {

    signupForm.addEventListener(
        "submit",
        async function (event) {

            event.preventDefault();

            // ========================================
            // GET FORM VALUES
            // ========================================

            const firstName =
                document.getElementById("signupFirstName").value.trim();

            const lastName =
                document.getElementById("signupLastName").value.trim();

            const email =
                document.getElementById("signupEmail").value.trim();

            const phone =
                document.getElementById("signupPhone").value.trim();

            const whatsappNumber =
                document.getElementById("signupWhatsapp").value.trim();

            const university =
                document.getElementById("signupUniversity").value.trim();

            const studentId =
                document.getElementById("signupStudentId").value.trim();

            const password =
                document.getElementById("signupPassword").value;

            const confirmPassword =
                document.getElementById("signupConfirmPassword").value;

            const agreedStudent =
                document.getElementById("agreedStudent").checked;

            const agreedTerms =
                document.getElementById("agreedTerms").checked;

            const agreedPrivacy =
                document.getElementById("agreedPrivacy").checked;

            const receiveNotifications =
                document.getElementById("receiveNotifications").checked;


            // ========================================
            // FRONTEND VALIDATION
            // ========================================

            if (
                !firstName ||
                !lastName ||
                !email ||
                !phone ||
                !university ||
                !studentId ||
                !password ||
                !confirmPassword
            ) {

                showMessage(
                    "Please fill in all required fields."
                );

                return;
            }


            // ========================================
            // PASSWORD CHECK
            // ========================================

            if (password !== confirmPassword) {

                showMessage(
                    "Passwords do not match."
                );

                return;
            }


            if (password.length < 6) {

                showMessage(
                    "Password must be at least 6 characters."
                );

                return;
            }


            // ========================================
            // STUDENT CONFIRMATION
            // ========================================

            if (!agreedStudent) {

                showMessage(
                    "Please confirm that you are a student."
                );

                return;
            }


            // ========================================
            // TERMS & PRIVACY
            // ========================================

            if (!agreedTerms || !agreedPrivacy) {

                showMessage(
                    "Please agree to the Terms and Privacy Policy."
                );

                return;
            }


            // ========================================
            // DISABLE BUTTON WHILE REGISTERING
            // ========================================

            const submitButton =
                document.getElementById("signupSubmit");

            if (submitButton) {

                submitButton.disabled = true;

                submitButton.textContent =
                    "Creating Account...";
            }


            // ========================================
            // SEND DATA TO BACKEND
            // ========================================

            try {

                const response = await fetch(
                    API_URL + "/api/students/register",
                    {

                        method: "POST",

                        headers: {
                            "Content-Type": "application/json"
                        },

                        body: JSON.stringify({

                            firstName: firstName,

                            lastName: lastName,

                            email: email,

                            phone: phone,

                            whatsappNumber:
                                whatsappNumber || null,

                            university: university,

                            studentId: studentId,

                            password: password,

                            confirmPassword:
                                confirmPassword,

                            agreedStudent:
                                agreedStudent,

                            agreedTerms:
                                agreedTerms,

                            agreedPrivacy:
                                agreedPrivacy,

                            receiveNotifications:
                                receiveNotifications

                        })

                    }
                );


                // ========================================
// READ BACKEND RESPONSE
// ========================================

const data =
    await response.json();


// ========================================
// CONTINUE UNVERIFIED REGISTRATION
// ========================================

if (
    response.ok &&
    data.success &&
    data.requiresVerification &&
    data.continueRegistration
) {

    console.log(
        "Continuing unverified registration:",
        data.student
    );


    showOtpVerificationScreen(
        data.studentId,
        data.email
    );


    return;

}


// ========================================
// INVALID OTP
// ========================================

if (!response.ok || !data.success) {

    showMessage(
        data.message ||
        "Something went wrong while creating the account."
    );

    return;
}


// ========================================
// SUCCESS - OTP VERIFICATION
// ========================================

console.log(
    "Registration successful:",
    data
);


// ========================================
// CONFIRM VERIFICATION DATA
// ========================================

if (
    !data.studentId ||
    !data.email
) {

    console.error(
        "Missing verification data:",
        data
    );

    showMessage(
        "Account was created, but verification information is missing."
    );

    return;
}


// ========================================
// CLEAR REGISTRATION FORM
// ========================================

signupForm.reset();


// ========================================
// SHOW OTP VERIFICATION SCREEN
// ========================================

showOtpVerificationScreen(
    data.studentId,
    data.email
);


            } catch (error) {

                console.error(
                    "Registration error:",
                    error
                );

                showMessage(
                    "Unable to connect to Kurios Stores server."
                );

            } finally {

                // ========================================
                // ENABLE BUTTON AGAIN
                // ========================================

                if (submitButton) {

                    submitButton.disabled = false;

                    submitButton.textContent =
                        "Create Student Account";

                }

            }

        }
    );

}


    /* =====================================================
       14. NOTIFICATIONS
       ===================================================== */


    const notificationButton =
        document.getElementById(
            "notificationButton"
        );


    const notificationPanel =
        document.getElementById(
            "notificationPanel"
        );


    const closeNotifications =
        document.getElementById(
            "closeNotifications"
        );


    const notificationList =
        document.getElementById(
            "notificationList"
        );


    const notificationBadge =
        document.getElementById(
            "notificationBadge"
        );



    /*
        Temporary local notifications.

        Later these will come from PostgreSQL.
    */

    let notifications =
        JSON.parse(
            localStorage.getItem(
                "kuriosNotifications"
            )
        ) || [];



    function saveNotifications() {

        localStorage.setItem(
            "kuriosNotifications",
            JSON.stringify(
                notifications
            )
        );

    }



    function renderNotifications() {


        if (!notificationList) {
            return;
        }



        notificationList.innerHTML = "";



        if (
            notifications.length === 0
        ) {

            notificationList.innerHTML = `

                <div class="empty-state">

                    <i class="fa-regular fa-bell-slash"></i>

                    <h4>
                        No notifications
                    </h4>

                    <p>
                        You're all caught up.
                    </p>

                </div>

            `;

        }



        notifications.forEach(
            function (notification) {


                const item =
                    document.createElement(
                        "div"
                    );


                item.className =
                    "notification-item";


                item.innerHTML = `

                    <div class="notification-icon">

                        <i class="fa-solid fa-bell"></i>

                    </div>

                    <div>

                        <strong>

                            ${notification.title}

                        </strong>

                        <p>

                            ${notification.message}

                        </p>

                    </div>

                `;


                notificationList.appendChild(
                    item
                );

            }
        );



        /*
            Update notification badge.
        */

        if (notificationBadge) {

            notificationBadge.textContent =
                notifications.length;

        }

    }



    if (notificationButton) {

        notificationButton.addEventListener(
            "click",
            function () {

                if (notificationPanel) {

                    notificationPanel.classList.toggle(
                        "active"
                    );

                }

            }
        );

    }



    if (closeNotifications) {

        closeNotifications.addEventListener(
            "click",
            function () {

                if (notificationPanel) {

                    notificationPanel.classList.remove(
                        "active"
                    );

                }

            }
        );

    }



    /* =====================================================
       15. CHAT SYSTEM — FRONTEND DEMO
       ===================================================== */


    const chatContacts =
        document.querySelectorAll(
            ".chat-contact"
        );


    const activeChatName =
        document.getElementById(
            "activeChatName"
        );


    const activeChatStatus =
        document.getElementById(
            "activeChatStatus"
        );


    const activeChatAvatar =
        document.getElementById(
            "activeChatAvatar"
        );


    const messages =
        document.getElementById(
            "messages"
        );


    const messageForm =
        document.getElementById(
            "messageForm"
        );


    const messageInput =
        document.getElementById(
            "messageInput"
        );


    const chatSearch =
        document.getElementById(
            "chatSearch"
        );



    /*
        Current selected contact.
    */

    let activeContact =
        "Elkurios";



    /*
        Temporary chat messages.

        REAL chat will later use:
        Node.js
        Express
        PostgreSQL
    */

    const chatMessages = {

        "Elkurios": [

            {
                type: "received",
                text:
                    "Hi! Welcome to Kurios Stores. How can we help you?",
                sender:
                    "Elkurios"
            },

            {
                type: "sent",
                text:
                    "Hello! I want to know if you have phone chargers available.",
                sender:
                    "You"
            },

            {
                type: "received",
                text:
                    "Yes, we do. You can check our Electronics section.",
                sender:
                    "Elkurios"
            }

        ],


        "Chisom": [],

        "Daniel": []

    };



    function displayChat(contact) {


        if (!messages) {
            return;
        }


        messages.innerHTML = "";



        const conversation =
            chatMessages[contact] || [];



        conversation.forEach(
            function (message) {


                const messageElement =
                    document.createElement(
                        "div"
                    );


                messageElement.className =
                    "message " +
                    message.type;


                messageElement.innerHTML = `

                    <div class="message-bubble">

                        ${message.text}

                    </div>

                    <span>

                        ${message.sender}

                    </span>

                `;


                messages.appendChild(
                    messageElement
                );

            }
        );



        /*
            Automatically scroll
            to the latest message.
        */

        messages.scrollTop =
            messages.scrollHeight;

    }



    /*
        Selecting a student or
        Elkurios changes the conversation.
    */

    chatContacts.forEach(
        function (contact) {


            contact.addEventListener(
                "click",
                function () {


                    chatContacts.forEach(
                        function (item) {

                            item.classList.remove(
                                "active"
                            );

                        }
                    );


                    contact.classList.add(
                        "active"
                    );


                    activeContact =
                        contact.dataset.contact;


                    if (activeChatName) {

                        activeChatName.textContent =
                            activeContact;

                    }


                    if (activeChatStatus) {

                        activeChatStatus.textContent =
                            activeContact ===
                            "Elkurios"
                                ? "Store Owner"
                                : "Student";

                    }


                    if (activeChatAvatar) {

                        activeChatAvatar.textContent =
                            activeContact
                                .charAt(0)
                                .toUpperCase();

                    }


                    displayChat(
                        activeContact
                    );

                }
            );

        }
    );



    /*
        Send a message.
    */

    if (messageForm) {

        messageForm.addEventListener(
            "submit",
            function (event) {

                event.preventDefault();


                if (!messageInput) {
                    return;
                }


                const text =
                    messageInput.value.trim();


                if (text === "") {
                    return;
                }



                if (
                    !chatMessages[
                        activeContact
                    ]
                ) {

                    chatMessages[
                        activeContact
                    ] = [];

                }



                chatMessages[
                    activeContact
                ].push({

                    type: "sent",

                    text: text,

                    sender: "You"

                });



                messageInput.value = "";


                displayChat(
                    activeContact
                );

            }
        );

    }



    /* =====================================================
       16. CHAT SEARCH
       ===================================================== */


    if (chatSearch) {

        chatSearch.addEventListener(
            "input",
            function () {


                const search =
                    chatSearch.value
                        .toLowerCase()
                        .trim();



                chatContacts.forEach(
                    function (contact) {


                        const name =
                            contact.dataset.contact
                                .toLowerCase();


                        if (
                            name.includes(search)
                        ) {

                            contact.style.display =
                                "";

                        }

                        else {

                            contact.style.display =
                                "none";

                        }

                    }
                );

            }
        );

    }



    /* =====================================================
       17. NEW CHAT BUTTON
       ===================================================== */


    const newChatButton =
        document.getElementById(
            "newChatButton"
        );


    if (newChatButton) {

        newChatButton.addEventListener(
            "click",
            function () {

                showMessage(
                    "New chat system will connect to registered students."
                );

            }
        );

    }



    /* =====================================================
       18. ELKURIOS BROADCAST
       ===================================================== */


    const broadcastForm =
        document.getElementById(
            "broadcastForm"
        );


    const broadcastModal =
        document.getElementById(
            "broadcastModal"
        );


    const closeBroadcast =
        document.getElementById(
            "closeBroadcast"
        );



    if (closeBroadcast) {

        closeBroadcast.addEventListener(
            "click",
            function () {

                if (broadcastModal) {

                    broadcastModal.classList.remove(
                        "active"
                    );

                }

            }
        );

    }



    /*
        IMPORTANT:

        This currently demonstrates
        the frontend behaviour only.

        The real broadcast system will be
        connected to PostgreSQL and Node.js
        after we create the notification API.
    */

    if (broadcastForm) {

        broadcastForm.addEventListener(
            "submit",
            function (event) {

                event.preventDefault();


                const title =
                    document.getElementById(
                        "broadcastTitle"
                    ).value.trim();


                const message =
                    document.getElementById(
                        "broadcastMessage"
                    ).value.trim();



                if (
                    title === "" ||
                    message === ""
                ) {

                    showMessage(
                        "Please enter a title and message."
                    );

                    return;

                }



                /*
                    Add a temporary notification
                    to this browser.
                */

                notifications.unshift({

                    title: title,

                    message: message

                });



                saveNotifications();

                renderNotifications();



                showMessage(
                    "Announcement created. The real all-students broadcast API comes next."
                );



                broadcastForm.reset();

            }
        );

    }



    /* =====================================================
       19. CHECKOUT
       ===================================================== */


    if (checkoutButton) {

        checkoutButton.addEventListener(
            "click",
            async function () {


                if (
                    cart.length === 0
                ) {

                    showMessage(
                        "Your cart is empty."
                    );

                    return;

                }


                // ========================================
                // MUST BE SIGNED IN TO CHECK OUT
                // ========================================

                const student =
                    getLoggedInStudent();

                if (!student) {

                    closeCartPanel();

                    showMessage(
                        "Please sign in to check out."
                    );

                    openSignInModal();

                    return;

                }


                checkoutButton.disabled = true;

                checkoutButton.textContent =
                    "Starting checkout...";


                try {

                    // ========================================
                    // START THE ORDER ON OUR SERVER
                    // (server recalculates the real total —
                    // never trust prices from the browser)
                    // ========================================

                    const initiateResponse =
                        await fetch(
                            API_URL + "/api/orders/initiate",
                            {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json"
                                },
                                body: JSON.stringify({
                                    studentId: student.id,
                                    items: cart,
                                    customerName:
                                        `${student.first_name || ""} ${student.last_name || ""}`.trim(),
                                    customerEmail: student.email
                                })
                            }
                        );

                    const initiateData =
                        await initiateResponse.json();

                    if (!initiateData.success) {

                        showMessage(
                            initiateData.message ||
                            "Could not start checkout."
                        );

                        return;

                    }


                    // ========================================
                    // HAND OFF TO THE MONNIFY PAYMENT WIDGET
                    // ========================================

                    closeCartPanel();

                    if (typeof MonnifySDK === "undefined") {

                        showMessage(
                            "Payment could not load. Please refresh and try again."
                        );

                        return;

                    }

                    MonnifySDK.initialize({

                        amount: initiateData.amount,

                        currency: "NGN",

                        reference: initiateData.paymentReference,

                        customerFullName:
                            initiateData.customerName,

                        customerEmail:
                            initiateData.customerEmail,

                        apiKey: initiateData.apiKey,

                        contractCode: initiateData.contractCode,

                        paymentDescription:
                            "Kurios Stores order",

                        onComplete: async function () {

                            await verifyOrderPayment(
                                initiateData.paymentReference
                            );

                        },

                        onClose: function () {

                            // Student closed the widget without
                            // finishing — we'll still catch a
                            // completed payment via the webhook,
                            // so nothing else to do here.

                        }

                    });

                } catch (error) {

                    console.error(
                        "Checkout error:",
                        error
                    );

                    showMessage(
                        "Could not reach the server. Please try again."
                    );

                } finally {

                    checkoutButton.disabled = false;

                    checkoutButton.textContent =
                        "Proceed to Checkout";

                }

            }
        );

    }


    // ========================================
    // CONFIRM A PAYMENT WITH OUR SERVER
    // (never trust the widget's onComplete alone)
    // ========================================

    async function verifyOrderPayment(paymentReference) {

        try {

            const response =
                await fetch(
                    API_URL + "/api/orders/verify",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            paymentReference: paymentReference
                        })
                    }
                );

            const data =
                await response.json();

            if (data.success) {

                cart = [];

                saveCart();

                updateCart();

                showMessage(
                    "Payment confirmed! Your order has been placed."
                );

            } else {

                showMessage(
                    "We couldn't confirm your payment yet. Check My Orders shortly, or contact support if this continues."
                );

            }

        } catch (error) {

            console.error(
                "Payment verification error:",
                error
            );

            showMessage(
                "We couldn't confirm your payment. Check My Orders shortly, or contact support if this continues."
            );

        }

    }



    /* =====================================================
       20. FOOTER INTERACTIONS
       ===================================================== */


    const socialLinks =
        document.querySelectorAll(
            ".social-links a"
        );


    socialLinks.forEach(
        function (link) {

            link.addEventListener(
                "click",
                function (event) {

                    event.preventDefault();


                    const label =
                        link.getAttribute(
                            "aria-label"
                        ) ||
                        "Social media";


                    showMessage(
                        label +
                        " link will be connected soon."
                    );

                }
            );

        }
    );



    /*
        Footer policy links.
    */

    const privacyLink =
        document.getElementById(
            "privacyLink"
        );


    const termsLink =
        document.getElementById(
            "termsLink"
        );


    const refundLink =
        document.getElementById(
            "refundLink"
        );



    if (privacyLink) {

        privacyLink.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                showMessage(
                    "Privacy Policy page coming soon."
                );

            }
        );

    }



    if (termsLink) {

        termsLink.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                showMessage(
                    "Terms of Service page coming soon."
                );

            }
        );

    }



    if (refundLink) {

        refundLink.addEventListener(
            "click",
            function (event) {

                event.preventDefault();

                showMessage(
                    "Refund Policy page coming soon."
                );

            }
        );

    }



    /* =====================================================
       21. FOOTER HEART
       ===================================================== */


    const footerHeart =
        document.querySelector(
            ".footer-love i"
        );


    if (footerHeart) {

        footerHeart.addEventListener(
            "click",
            function () {


                footerHeart.classList.toggle(
                    "fa-regular"
                );


                footerHeart.classList.toggle(
                    "fa-solid"
                );


                showMessage(
                    "Together for a greater campus ❤️"
                );

            }
        );

    }



    /* =====================================================
       22. GENERAL MESSAGE / TOAST
       ===================================================== */


    function showMessage(message) {


        /*
            Create a toast notification.
        */

        let toast =
            document.getElementById(
                "kuriosToast"
            );



        /*
            If the toast doesn't exist,
            create it.
        */

        if (!toast) {

            toast =
                document.createElement(
                    "div"
                );


            toast.id =
                "kuriosToast";


            toast.className =
                "kurios-toast";


            document.body.appendChild(
                toast
            );

        }



        toast.textContent =
            message;


        toast.classList.add(
            "show"
        );



        /*
            Remove it after 3 seconds.
        */

        setTimeout(
            function () {

                toast.classList.remove(
                    "show"
                );

            },
            3000
        );

    }



    /* =====================================================
       23. SMOOTH SCROLLING
       ===================================================== */


    document.querySelectorAll(
        'a[href^="#"]'
    ).forEach(
        function (link) {


            link.addEventListener(
                "click",
                function (event) {


                    const targetId =
                        link.getAttribute(
                            "href"
                        );


                    if (
                        !targetId ||
                        targetId === "#"
                    ) {

                        return;

                    }


                    /*
                        Don't interfere with
                        modal links.
                    */

                    if (
                        targetId ===
                        "#signin"
                    ) {

                        event.preventDefault();

                        openSignInModal();

                        return;

                    }



                    const target =
                        document.querySelector(
                            targetId
                        );


                    if (target) {

                        event.preventDefault();


                        target.scrollIntoView({

                            behavior: "smooth",

                            block: "start"

                        });

                    }

                }
            );

        }
    );



    /* =====================================================
       24. INITIALIZE EVERYTHING
       ===================================================== */


    /*
        Show saved cart.
    */

    updateCart();



    /*
        Show saved notifications.
    */

    renderNotifications();



    /*
        Show Elkurios conversation.
    */

    displayChat(
        "Elkurios"
    );



    /*
        IMPORTANT:

        This is where the frontend
        contacts our Node.js backend.
    */

    loadProducts();


});

/* =========================================
   SIGN UP MODAL
========================================= */

const signUpModal =
    document.getElementById("signUpModal");

const openSignUp =
    document.getElementById("openSignUp");

const closeSignUp =
    document.getElementById("closeSignUp");

const backToSignIn =
    document.getElementById("backToSignIn");


/* OPEN SIGN UP */

if (openSignUp) {

    openSignUp.addEventListener(
        "click",
        function(event) {

            event.preventDefault();

            if (signInModal) {
                signInModal.classList.remove("open");
            }

            if (signUpModal) {
                signUpModal.classList.add("open");
            }

        }
    );

}


/* CLOSE SIGN UP */

if (closeSignUp) {

    closeSignUp.addEventListener(
        "click",
        function() {

            if (signUpModal) {
                signUpModal.classList.remove("open");
            }

        }
    );

}


/* BACK TO SIGN IN */

if (backToSignIn) {

    backToSignIn.addEventListener(
        "click",
        function(event) {

            event.preventDefault();

            if (signUpModal) {
                signUpModal.classList.remove("open");
            }

            if (signInModal) {
                signInModal.classList.add("open");
            }

        }
    );

}

/* =========================================
   SIGNUP MODAL SCROLLBAR
========================================= */

const signupModalContent =
    document.querySelector("#signUpModal .auth-modal");

let signupScrollbarTimer;

if (signupModalContent) {

    signupModalContent.addEventListener(
        "scroll",
        function () {

            // Show scrollbar while scrolling
            signupModalContent.classList.add(
                "is-scrolling"
            );

            // Reset the timer
            clearTimeout(
                signupScrollbarTimer
            );

            // Hide scrollbar after scrolling stops
            signupScrollbarTimer = setTimeout(
                function () {

                    signupModalContent.classList.remove(
                        "is-scrolling"
                    );

                },
                700
            );

        }
    );

}

// ========================================
// STUDENT EMAIL OTP VERIFICATION
// ========================================

let currentStudentId = null;
let currentStudentEmail = null;


// ========================================
// OTP ELEMENTS
// ========================================

const otpScreen =
    document.getElementById("otpVerificationScreen");

const otpDigits =
    document.querySelectorAll(".otp-digit");

const otpInput =
    document.getElementById("otpInput");

const verifyOtpButton =
    document.getElementById("verifyOtpButton");

const resendOtpButton =
    document.getElementById("resendOtpButton");

const otpStatusMessage =
    document.getElementById("otpStatusMessage");


// ========================================
// SHOW OTP VERIFICATION SCREEN
// ========================================

function showOtpVerificationScreen(studentId, email) {

    currentStudentId = studentId;
    currentStudentEmail = email;


    // ========================================
    // HIDE SIGNUP FORM
    // ========================================

    const signupForm =
        document.getElementById("signupForm");

    if (signupForm) {

        signupForm.style.display = "none";

    }


    // ========================================
    // SHOW OTP SCREEN
    // ========================================

    if (otpScreen) {

        otpScreen.style.display = "block";

    }


    // ========================================
    // UPDATE EMAIL MESSAGE
    // ========================================

    const otpMessage =
        document.getElementById(
            "otpVerificationMessage"
        );

    if (otpMessage) {

        otpMessage.innerHTML = `
            We've sent a 6-digit verification code to
            <strong>${email}</strong>.<br><br>
            Please enter the code below to activate
            your account.
        `;

    }


    // ========================================
    // CLEAR OTP BOXES
    // ========================================

    otpDigits.forEach(function (input) {

        input.value = "";

    });


    if (otpInput) {

        otpInput.value = "";

    }


    // ========================================
    // CLEAR STATUS
    // ========================================

    if (otpStatusMessage) {

        otpStatusMessage.textContent = "";

    }


    // ========================================
    // FOCUS FIRST BOX
    // ========================================

    if (otpDigits.length > 0) {

        otpDigits[0].focus();

    }

}


// ========================================
// UPDATE COMBINED OTP
// ========================================

function updateCombinedOtp() {

    let combinedOtp = "";

    otpDigits.forEach(function (input) {

        combinedOtp += input.value;

    });


    if (otpInput) {

        otpInput.value = combinedOtp;

    }


    return combinedOtp;

}


// ========================================
// OTP BOX INPUT HANDLING
// ========================================

otpDigits.forEach(function (input, index) {


    // ========================================
    // INPUT
    // ========================================

    input.addEventListener(
        "input",
        function () {

            // Numbers only
            this.value =
                this.value.replace(/\D/g, "");


            // Keep only one digit
            if (this.value.length > 1) {

                this.value =
                    this.value.slice(-1);

            }


            // Update hidden OTP
            updateCombinedOtp();


            // Move to next box
            if (
                this.value &&
                index < otpDigits.length - 1
            ) {

                otpDigits[index + 1].focus();

            }

        }
    );


    // ========================================
    // KEYBOARD HANDLING
    // ========================================

    input.addEventListener(
        "keydown",
        function (event) {


            // Backspace
            if (
                event.key === "Backspace" &&
                !this.value &&
                index > 0
            ) {

                otpDigits[index - 1].focus();

            }


            // Left arrow
            if (
                event.key === "ArrowLeft" &&
                index > 0
            ) {

                otpDigits[index - 1].focus();

            }


            // Right arrow
            if (
                event.key === "ArrowRight" &&
                index < otpDigits.length - 1
            ) {

                otpDigits[index + 1].focus();

            }

        }
    );


    // ========================================
    // PASTE COMPLETE OTP
    // ========================================

    input.addEventListener(
        "paste",
        function (event) {

            event.preventDefault();

            const pastedText =
                event.clipboardData
                    .getData("text")
                    .replace(/\D/g, "")
                    .slice(0, 6);


            if (!pastedText) {

                return;

            }


            pastedText
                .split("")
                .forEach(function (digit, digitIndex) {

                    if (
                        otpDigits[digitIndex]
                    ) {

                        otpDigits[digitIndex].value =
                            digit;

                    }

                });


            updateCombinedOtp();


            const focusIndex =
                Math.min(
                    pastedText.length,
                    otpDigits.length - 1
                );

            if (otpDigits[focusIndex]) {

                otpDigits[focusIndex].focus();

            }

        }
    );

});


// ========================================
// VERIFY OTP
// ========================================

if (verifyOtpButton) {

    verifyOtpButton.addEventListener(
        "click",
        async function () {


            // ========================================
            // COMBINE OTP
            // ========================================

            const otp =
                updateCombinedOtp();


            // ========================================
            // CLEAR PREVIOUS STATUS
            // ========================================

            if (otpStatusMessage) {

                otpStatusMessage.textContent = "";

            }


            // ========================================
            // VALIDATE OTP
            // ========================================

            if (!/^\d{6}$/.test(otp)) {

                if (otpStatusMessage) {

                    otpStatusMessage.textContent =
                        "Please enter the complete 6-digit verification code.";

                }

                return;

            }


            // ========================================
            // CHECK STUDENT ID
            // ========================================

            if (!currentStudentId) {

                if (otpStatusMessage) {

                    otpStatusMessage.textContent =
                        "Your verification session has expired. Please restart registration.";

                }

                return;

            }


            // ========================================
            // DISABLE VERIFY BUTTON
            // ========================================

            verifyOtpButton.disabled = true;

            verifyOtpButton.innerHTML = `
                <span class="otp-button-icon">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                </span>

                <span class="otp-button-text">
                    Verifying...
                </span>

                <span class="otp-button-arrow">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                </span>
            `;


            try {


                // ========================================
                // SEND OTP TO BACKEND
                // ========================================

                const response =
                    await fetch(
                        API_URL + "/api/students/verify-otp",
                        {

                            method: "POST",

                            headers: {

                                "Content-Type":
                                    "application/json"

                            },

                            body: JSON.stringify({

                                studentId:
                                    currentStudentId,

                                otp:
                                    otp

                            })

                        }
                    );


                // ========================================
                // READ RESPONSE
                // ========================================

                const data =
                    await response.json();


                // ========================================
                // INVALID OTP
                // ========================================

                if (
                    !response.ok ||
                    !data.success
                ) {

                    if (otpStatusMessage) {

                        otpStatusMessage.textContent =
                            data.message ||
                            "Invalid or expired verification code.";

                    }


                    verifyOtpButton.disabled =
                        false;


                    verifyOtpButton.innerHTML = `
                        <span class="otp-button-icon">
                            <i class="fa-solid fa-shield-halved"></i>
                        </span>

                        <span class="otp-button-text">
                            Verify Account
                        </span>

                        <span class="otp-button-arrow">
                            <i class="fa-solid fa-arrow-right"></i>
                        </span>
                    `;


                    return;

                }


                // ========================================
                // SUCCESS
                // ========================================

                console.log(
                    "Student email verified successfully:",
                    data.student
                );


                if (otpStatusMessage) {

                    otpStatusMessage.textContent =
                        "Email verified successfully!";

                }


                // ========================================
                // HIDE OTP SCREEN
                // ========================================

                if (otpScreen) {

                    otpScreen.style.display =
                        "none";

                }


                // ========================================
                // UPDATE MODAL TITLE
                // ========================================

                const accountModalTitle =
                    document.getElementById(
                        "accountModalTitle"
                    );

                if (accountModalTitle) {

                    accountModalTitle.textContent =
                        "Account Created Successfully! 🎉";

                }


                // ========================================
                // HIDE MODAL SUBTITLE
                // ========================================

                const accountModalSubtitle =
                    document.getElementById(
                        "accountModalSubtitle"
                    );

                if (accountModalSubtitle) {

                    accountModalSubtitle.style.display =
                        "none";

                }


                // ========================================
                // SHOW SUCCESS SCREEN
                // ========================================

                const successScreen =
                    document.getElementById(
                        "accountCreatedSuccessScreen"
                    );

                if (successScreen) {

                    successScreen.style.display =
                        "block";

                }


                // ========================================
                // RESET OTP
                // ========================================

                otpDigits.forEach(
                    function (input) {

                        input.value = "";

                    }
                );


                if (otpInput) {

                    otpInput.value = "";

                }


            } catch (error) {

                console.error(
                    "OTP verification error:",
                    error
                );


                if (otpStatusMessage) {

                    otpStatusMessage.textContent =
                        "Unable to connect to Kurios Stores server. Please try again.";

                }


                verifyOtpButton.disabled =
                    false;


                verifyOtpButton.innerHTML = `
                    <span class="otp-button-icon">
                        <i class="fa-solid fa-shield-halved"></i>
                    </span>

                    <span class="otp-button-text">
                        Verify Account
                    </span>

                    <span class="otp-button-arrow">
                        <i class="fa-solid fa-arrow-right"></i>
                    </span>
                `;

            }

        }
    );

}


// ========================================
// RESEND OTP
// ========================================

if (resendOtpButton) {

    resendOtpButton.addEventListener(
        "click",
        async function () {


            // ========================================
            // CHECK SESSION
            // ========================================

            if (
                !currentStudentId ||
                !currentStudentEmail
            ) {

                if (otpStatusMessage) {

                    otpStatusMessage.textContent =
                        "Unable to resend OTP. Please restart registration.";

                }

                return;

            }


            // ========================================
            // DISABLE RESEND BUTTON
            // ========================================

            resendOtpButton.disabled =
                true;

            resendOtpButton.innerHTML = `
                <i class="fa-solid fa-spinner fa-spin"></i>
                <span>Sending...</span>
            `;


            try {


                // ========================================
                // SEND RESEND REQUEST
                // ========================================

                const response =
                    await fetch(
                        API_URL + "/api/students/resend-otp",
                        {

                            method: "POST",

                            headers: {

                                "Content-Type":
                                    "application/json"

                            },

                            body: JSON.stringify({

                                studentId:
                                    currentStudentId,

                                email:
                                    currentStudentEmail

                            })

                        }
                    );


                // ========================================
                // READ RESPONSE
                // ========================================

                const data =
                    await response.json();


                // ========================================
                // HANDLE ERROR
                // ========================================

                if (
                    !response.ok ||
                    !data.success
                ) {

                    if (otpStatusMessage) {

                        otpStatusMessage.textContent =
                            data.message ||
                            "Unable to resend verification code.";

                    }

                    return;

                }


                // ========================================
                // RESEND SUCCESS
                // ========================================

                if (otpStatusMessage) {

                    otpStatusMessage.textContent =
                        "A new verification code has been sent to your email.";

                }


                // ========================================
                // CLEAR OTP BOXES
                // ========================================

                otpDigits.forEach(
                    function (input) {

                        input.value = "";

                    }
                );


                if (otpInput) {

                    otpInput.value = "";

                }


                // ========================================
                // FOCUS FIRST BOX
                // ========================================

                if (otpDigits.length > 0) {

                    otpDigits[0].focus();

                }


            } catch (error) {

                console.error(
                    "Resend OTP error:",
                    error
                );


                if (otpStatusMessage) {

                    otpStatusMessage.textContent =
                        "Unable to connect to Kurios Stores server.";

                }

            } finally {


                // ========================================
                // RESTORE RESEND BUTTON
                // ========================================

                resendOtpButton.disabled =
                    false;

                resendOtpButton.innerHTML = `
                    <i class="fa-solid fa-rotate"></i>

                    <span>
                        Resend OTP
                    </span>
                `;

            }

        }
    );

}


// ========================================
// SUCCESS SCREEN → LOGIN
// ========================================

const successLoginLink =
    document.getElementById(
        "successLoginLink"
    );

if (successLoginLink) {

    successLoginLink.addEventListener(
        "click",
        function (event) {

            event.preventDefault();


            // ========================================
            // HIDE SUCCESS SCREEN
            // ========================================

            const successScreen =
                document.getElementById(
                    "accountCreatedSuccessScreen"
                );

            if (successScreen) {

                successScreen.style.display =
                    "none";

            }


            // ========================================
            // SHOW SIGN IN FORM
            // ========================================

            const signinForm =
                document.getElementById(
                    "signinForm"
                );

            if (signinForm) {

                signinForm.style.display =
                    "block";

            }


            // ========================================
            // UPDATE MODAL TITLE
            // ========================================

            const accountModalTitle =
                document.getElementById(
                    "accountModalTitle"
                );

            if (accountModalTitle) {

                accountModalTitle.textContent =
                    "Welcome Back";

            }


            // ========================================
            // SHOW SIGN IN SUBTITLE
            // ========================================

            const accountModalSubtitle =
                document.getElementById(
                    "accountModalSubtitle"
                );

            if (accountModalSubtitle) {

                accountModalSubtitle.style.display =
                    "block";

                accountModalSubtitle.textContent =
                    "Sign in to your Kurios Stores account.";

            }

        }
    );

}