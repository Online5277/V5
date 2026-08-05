import { Mixin } from '../../utils/MixinManager';
import { ModuleBase } from '../../utils/ModuleBase';
import { Utils } from '../../utils/Utils';

class ProfileHider extends ModuleBase {
    constructor() {
        super({
            name: 'Profile Hider',
            subcategory: 'Visuals',
            description: 'Hides your profile',
        });

        this.defaultName = null;
        this.HIDE_USERNAME = true;
        this.USERNAME = null;

        this.addToggle(
            'Custom Username',
            (v) => {
                this.HIDE_USERNAME = v;
                this.updateMixin();
            },
            'Allows for custom usernames',
            true
        );
        this.addTextInput(
            'Username',
            ' ',
            (v) => {
                this.USERNAME = v;
                this.updateMixin();
            },
            'The username you want to use'
        );
    }

    getUsername() {
        try {
            const saved = Utils.getConfigFile('AuthCache/do_not_share_this_file')?.username;
            if (saved) return saved;
        } catch (e) {
            console.error('V5 Caught error' + e + e.stack);
            console.error('Failed to load saved username');
        }
        return null;
    }

    updateMixin() {
        if (!this.defaultName) this.defaultName = this.getUsername();
        Mixin.set('profileHiderReplacement', (this.HIDE_USERNAME && this.USERNAME?.trim()) || this.defaultName || 'Hidden');
    }

    onEnable() {
        this.updateMixin();
        Mixin.set('profileHiderEnabled', true);
    }

    onDisable() {
        Mixin.set('profileHiderEnabled', false);
    }
}

new ProfileHider();
