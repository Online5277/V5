import { Categories } from './categories/CategorySystem';
import { GuiState } from './core/GuiState';
import { isGuiClickSoundEnabled, setGuiClickSoundEnabled } from './Utils';

const initProfileSettings = () => {
    let guiScaleSetting;
    let discordCat = Categories.categories.find((category) => category.name === 'Discord');
    if (!discordCat) {
        discordCat = {
            name: 'Discord',
            items: [],
            subcategories: [],
            directComponents: [],
            hiddenInSidebar: true,
        };
        Categories.categories.push(discordCat);
    } else if (!discordCat.directComponents) {
        discordCat.directComponents = [];
    }

    const hasScrollSpeed = discordCat.directComponents.some((component) => component.title === 'GUI Scroll Speed');
    if (!hasScrollSpeed) {
        Categories.addSettingsSlider(
            'GUI Scroll Speed',
            5,
            45,
            Categories.guiScrollSpeed,
            (value) => {
                Categories.guiScrollSpeed = Math.max(1, Number(value) || 15);
            },
            'Adjusts how fast the GUI panels scroll.',
            'GUI',
            'Discord'
        );
    }

    const hasGuiScale = discordCat.directComponents.some((component) => component.title === 'GUI Scale');
    if (!hasGuiScale) {
        guiScaleSetting = Categories.addSettingsSlider(
            'GUI Scale',
            0.5,
            2,
            GuiState.guiScale,
            (value) => {
                if (guiScaleSetting.dragging) GuiState.pendingGuiScale = value;
                else GuiState.setGuiScale(value);
            },
            'Adjusts the size of the V5 GUI.',
            'GUI',
            'Discord'
        );
    }

    const hasClickSound = discordCat.directComponents.some((component) => component.title === 'GUI Click Sound');
    if (!hasClickSound) {
        Categories.addSettingsToggle(
            'GUI Click Sound',
            (value) => {
                setGuiClickSoundEnabled(!!value);
            },
            'Plays a click sound when interacting with GUI.',
            isGuiClickSoundEnabled(),
            'GUI',
            'Discord'
        );
    }
};

initProfileSettings();
