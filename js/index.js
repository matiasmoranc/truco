

let menuHamb = document.querySelector('.header__mobile.mobile');
let menuMobile = document.querySelector('.header__menu-mobile');
let website = document.querySelector('.website');

//menu hamb
menuHamb.addEventListener('click', () => {
    if (menuHamb.classList.contains('cerrado')) {
        menuHamb.classList.remove('cerrado');
        menuHamb.children[0].classList.add('sup');
        menuHamb.children[1].classList.add('med');
        menuHamb.children[2].classList.add('inf');
        menuMobile.classList.remove('ocultar');
    } else {
        menuHamb.classList.add('cerrado');
        menuHamb.children[0].classList.remove('sup');
        menuHamb.children[1].classList.remove('med');
        menuHamb.children[2].classList.remove('inf');
        menuMobile.classList.add('ocultar');
    }
});

//agendar
let ctaAgendar = document.getElementById('cta-agendar');
let agendar = document.getElementById('agendar');
let cerrarAgenda = document.querySelector('.cerrar-agenda');
ctaAgendar.addEventListener('click', () => {
   agendar.classList.remove('ocultar');   
});
cerrarAgenda.addEventListener('click', () => {
   agendar.classList.add('ocultar');   
});

//abrir fotos
let fotos = document.querySelectorAll('.fotos__cont-img');
for (let i = 0; i < fotos.length; i++) {
    let foto = fotos[i];
    
    foto.addEventListener('click', () => {
        let src = foto.children[0].src;
        console.log(src);
        
        let div = document.createElement('div');
        div.classList.add('fondo-oscuro');
        div.classList.add('activar-fondo-oscuro');

        div.innerHTML = `
            <div class="cont-img-abrir">
                <img src="${src}" alt="foto">
            </div>
            <div class="cerrar-img">
                <img src="img/cerrar.webp" alt="cerrar">
            </div>
        `;

        website.appendChild(div);

        let cerrar = document.querySelector('.cerrar-img');
        cerrar.addEventListener('click', () => {
           div.remove();
        });
    });

}

//abrir equipo
function ctaEquipo() {
    
    let div = document.createElement('div');
    div.classList.add('fondo-oscuro');
    div.classList.add('activar-fondo-oscuro');

    div.innerHTML = `
        <div class="equipo">
           <p>Equipo</p>
        </div>
        <div class="cerrar-img">
            <img src="img/cerrar.webp" alt="cerrar">
        </div>
    `;

    website.appendChild(div);

    let cerrar = document.querySelector('.cerrar-img');
    cerrar.addEventListener('click', () => {
       div.remove();
    });
}

//btn modo oscuro 
let btnOscuro = document.querySelector('.btn-modo');
let header = document.querySelector('.header');
let headerMobile = document.querySelector('.header__menu-mobile');
let banner = document.querySelector('.banner');
let contenido = document.querySelector('.contenido');
let ubicacion = document.querySelector('.ubicacion');

btnOscuro.addEventListener('click', () => {
    if (btnOscuro.classList.contains('activ')) {
        btnOscuro.classList.remove('activ');  
        btnOscuro.children[0].classList.remove('activ');  

        website.classList.remove('oscuro');
        header.classList.remove('oscuro');
        headerMobile.classList.remove('oscuro');
        banner.classList.remove('oscuro');
        contenido.classList.remove('oscuro');
        ubicacion.classList.remove('oscuro');

    } else {
        btnOscuro.classList.add('activ');  
        btnOscuro.children[0].classList.add('activ');  


        website.classList.add('oscuro');
        header.classList.add('oscuro');
        headerMobile.classList.add('oscuro');
        banner.classList.add('oscuro');
        contenido.classList.add('oscuro');
        ubicacion.classList.add('oscuro');
    }
 });





